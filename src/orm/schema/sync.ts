import { QueryInterface } from './query-interface';
import { buildCreateTableDdl, buildForeignKeyConstraintDdl, getForeignKeySpec, specKey } from './column-ddl';
import { findMatchingForeignKey } from './introspect';
import { ColumnOptions } from '../data-types';
import { getAssociations } from '../associations';
import type { SyncOptions, SyncResult } from './types';
import type { Connection } from '../connection';

export type OriusORMForSync = {
    getConnection(): Connection;
    models: Record<string, any>;
};

function collectUniqueModels(orm: OriusORMForSync, filter?: string[]): any[] {
    const byTable = new Set<string>();
    const out: any[] = [];
    for (const m of Object.values(orm.models)) {
        if (!m || typeof m !== 'function') continue;
        const t = String((m as any).tableName || '').toUpperCase();
        if (!t || byTable.has(t)) continue;
        if (filter?.length) {
            const modelName = String((m as any).modelName || m.name || '');
            const ok = filter.some(
                (f) =>
                    f.toUpperCase() === t ||
                    f === modelName ||
                    f.toUpperCase() === modelName.toUpperCase()
            );
            if (!ok) continue;
        }
        byTable.add(t);
        out.push(m);
    }
    return out;
}

/** Tabelas de junção de `belongsToMany` registadas, para entrarem no `sync` / ordenação. */
function mergeJunctionFromBelongsToMany(orm: OriusORMForSync, list: any[]): any[] {
    const byTable = new Set(
        list.map((m) => String((m as any).tableName || '').toUpperCase()).filter(Boolean)
    );
    const extra: any[] = [];
    for (const m of list) {
        for (const def of getAssociations(m as any)) {
            if (def.type !== 'belongsToMany' || !def.through) continue;
            const T = def.through as any;
            const t = String(T?.tableName || '').toUpperCase();
            if (!t || byTable.has(t)) continue;
            if (!Object.values(orm.models).some((V) => V === T)) continue;
            byTable.add(t);
            extra.push(T);
        }
    }
    return list.concat(extra);
}

/**
 * Ordem de criação (pais → filhos). Filhos com FK só para tabelas fora do conjunto
 * entram com grau de entrada 0.
 */
export function topologicalSortForSync(models: any[], orm: OriusORMForSync): any[] {
    const tableToModel = new Map<string, any>();
    for (const m of models) {
        tableToModel.set(String((m as any).tableName).toUpperCase(), m);
    }
    const nodes = new Set<string>([...tableToModel.keys()]);
    const adj = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();
    for (const n of nodes) {
        inDegree.set(n, 0);
    }

    for (const m of models) {
        const child = String((m as any).tableName).toUpperCase();
        const schema = ((m as any).schema || {}) as Record<string, ColumnOptions>;
        for (const [colName, col] of Object.entries(schema)) {
            const spec = getForeignKeySpec(child, colName, col, orm);
            if (!spec) continue;
            const parent = spec.parentTable.toUpperCase();
            if (!nodes.has(parent)) continue;
            if (!adj.has(parent)) adj.set(parent, new Set());
            const set = adj.get(parent)!;
            if (!set.has(child)) {
                set.add(child);
                inDegree.set(child, (inDegree.get(child) || 0) + 1);
            }
        }
    }

    const queue: string[] = [];
    for (const [n, d] of inDegree) {
        if (d === 0) queue.push(n);
    }
    queue.sort();

    const order: string[] = [];
    while (queue.length) {
        const u = queue.shift()!;
        order.push(u);
        for (const v of adj.get(u) || []) {
            const nd = (inDegree.get(v) || 0) - 1;
            inDegree.set(v, nd);
            if (nd === 0) {
                queue.push(v);
                queue.sort();
            }
        }
    }

    if (order.length !== nodes.size) {
        throw new Error(
            'Ciclo de FKs entre models (ou dependência não resolvível). Ajuste `references` ou sincronize em etapas.'
        );
    }

    return order.map((t) => tableToModel.get(t)).filter(Boolean);
}

export async function syncOriusORM(orm: OriusORMForSync, options: SyncOptions = {}): Promise<SyncResult> {
    const qi = new QueryInterface(orm.getConnection());
    const result: SyncResult = {
        createdTables: [],
        createdForeignKeys: [],
        droppedTables: [],
        skipped: { existingTables: [], existingForeignKeys: [] },
        sql: []
    };

    const baseModels = collectUniqueModels(orm, options.modelNames);
    const models = mergeJunctionFromBelongsToMany(orm, baseModels);
    if (!models.length) {
        return result;
    }

    const createOrder = topologicalSortForSync(models, orm);
    const dropOrder = [...createOrder].reverse();
    const tx = options.transaction;
    const dry = !!options.dryRun;
    const log = options.logging;

    const runSql = async (sql: string) => {
        result.sql.push(sql);
        if (!dry) {
            await orm.getConnection().execute(sql, [], tx, { logging: log, benchmark: false });
        }
    };

    if (options.force && !options.fksOnly) {
        for (const m of dropOrder) {
            const table = String((m as any).tableName);
            if (dry) {
                if (await qi.tableExists(table, tx)) {
                    const s = `DROP TABLE ${String(table).toUpperCase()};`;
                    result.sql.push(s);
                }
            } else {
                if (await qi.tableExists(table, tx)) {
                    await qi.dropTable(table, tx, log);
                    result.droppedTables.push(table.toUpperCase());
                }
            }
        }
    }

    let existingFks = await qi.listForeignKeys(tx);

    if (!options.fksOnly) {
        for (const m of createOrder) {
            const table = String((m as any).tableName);
            const schema = ((m as any).schema || {}) as Record<string, ColumnOptions>;
            const attrKeys = Object.keys(schema);
            const exists = await qi.tableExists(table, tx);
            if (exists) {
                result.skipped.existingTables.push(table.toUpperCase());
                continue;
            }
            const createSql = buildCreateTableDdl(table, attrKeys, schema, { useIdentity: true }) + ';';
            await runSql(createSql);
            result.createdTables.push(table.toUpperCase());
        }
    }

    if (options.tablesOnly) {
        return result;
    }

    existingFks = await qi.listForeignKeys(tx);

    for (const m of createOrder) {
        const childTable = String((m as any).tableName);
        const schema = ((m as any).schema || {}) as Record<string, ColumnOptions>;
        for (const [colName, col] of Object.entries(schema)) {
            if (!col.references) continue;
            const spec = getForeignKeySpec(childTable, colName, col, orm);
            if (!spec) continue;
            if (findMatchingForeignKey(existingFks, spec)) {
                result.skipped.existingForeignKeys.push(specKey(spec));
                continue;
            }
            const sql = buildForeignKeyConstraintDdl(spec.childTable, [spec]) + ';';
            await runSql(sql);
            result.createdForeignKeys.push(spec.constraintName);
            if (!dry) {
                existingFks = await qi.listForeignKeys(tx);
            } else {
                existingFks = [
                    ...existingFks,
                    {
                        constraintName: spec.constraintName,
                        childTable: spec.childTable,
                        childField: spec.childField,
                        parentTable: spec.parentTable,
                        parentField: spec.parentField,
                        onDelete: 'NO ACTION',
                        onUpdate: 'NO ACTION',
                        segmentPosition: 0
                    } as any
                ];
            }
        }
    }

    return result;
}

export async function syncModelWithOrm(orm: OriusORMForSync, modelClass: any, options: SyncOptions = {}): Promise<SyncResult> {
    const name = (modelClass as any).modelName || modelClass.name;
    const t = (modelClass as any).tableName;
    return syncOriusORM(orm, { ...options, modelNames: [name, t].filter(Boolean) as string[] });
}
