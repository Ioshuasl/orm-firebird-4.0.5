// src/orm/query/select.ts

import { QueryOptions, QueryResult, TableInput, ModelStatic, IncludeOptions } from './types';
import { WhereBuilder } from './where';
import { findAssociation } from '../associations';
import { normalizeSortDirection, sanitizeIdentifier } from '../sql-utils';
import { splitJoinIncludesAndCollectSeparatePlans } from './include-separate';

function includeHasSeparateDeep(inc?: IncludeOptions | IncludeOptions[]): boolean {
    if (!inc) return false;
    const list = Array.isArray(inc) ? inc : [inc];
    for (const x of list) {
        if (!x) continue;
        if (x.separate) return true;
        const ch = x.include
            ? (Array.isArray(x.include) ? x.include : [x.include])
            : [];
        if (includeHasSeparateDeep(ch)) return true;
    }
    return false;
}

export class SelectBuilder {
    private static joinAliasCounter = 0;

    /**
     * Resolve o nome da tabela a partir de uma string ou de um Model
     */
    private static resolveTableName(input: TableInput): string {
        if (typeof input === 'string') return sanitizeIdentifier(input, 'table');
        return sanitizeIdentifier((input as ModelStatic).tableName, 'table');
    }

    public static build(table: TableInput, options: QueryOptions): QueryResult {
        const { where, limit, offset, order, attributes, include: rawInclude } = options;
        const mainTableName = this.resolveTableName(table);
        const mainAlias = 'T1';
        let allParams: any[] = [];
        const includeMeta: QueryResult['includeMeta'] = [];
        this.joinAliasCounter = 0;
        const sourceModel = typeof table === 'string' ? undefined : (table as ModelStatic);
        const includeList: IncludeOptions[] = !rawInclude
            ? []
            : (Array.isArray(rawInclude) ? rawInclude : [rawInclude]);
        if (includeHasSeparateDeep(includeList) && !sourceModel) {
            throw new Error(
                'include com `separate: true` exige o Model na raiz (ex.: `findAll` no model), não só o nome da tabela.'
            );
        }
        const separateOut: NonNullable<QueryResult['separatePlans']> = [];
        const joinOnly =
            includeList.length && sourceModel
                ? splitJoinIncludesAndCollectSeparatePlans(includeList, sourceModel, [], separateOut)
                : includeList;

        // 1. Projeção de Colunas
        let selectCols = attributes 
            ? attributes.map(a => `${mainAlias}.${sanitizeIdentifier(a, 'column')}`).join(', ')
            : `${mainAlias}.*`;

        // 2. Joins (Includes) com recursão (sem `separate: true` — isso vira outra SELECT)
        let joinSql = '';
        if (joinOnly.length) {
            const includeResult = this.buildIncludesRecursive({
                includes: joinOnly,
                sourceModel,
                parentAlias: mainAlias,
                parentPath: [],
                params: allParams
            });
            joinSql += includeResult.joinSql;
            selectCols += includeResult.selectCols;
            includeMeta?.push(...includeResult.includeMeta);
        }

        const { sql: whereSql, params } = WhereBuilder.build(where, mainAlias);
        allParams.push(...params);

        let sql = `SELECT ${selectCols} FROM ${mainTableName} ${mainAlias}${joinSql}${whereSql}`;

        if (order) {
            sql += ` ORDER BY ` + order
                .map(([col, dir]) => `${mainAlias}.${sanitizeIdentifier(col, 'column')} ${normalizeSortDirection(dir)}`)
                .join(', ');
        }

        if (offset !== undefined) sql += ` OFFSET ${offset} ROWS`;
        if (limit !== undefined) sql += ` FETCH FIRST ${limit} ROWS ONLY`;

        return { sql, params: allParams, includeMeta, separatePlans: separateOut.length ? separateOut : undefined };
    }

    private static buildIncludesRecursive(args: {
        includes: IncludeOptions[];
        sourceModel?: ModelStatic;
        parentAlias: string;
        parentPath: string[];
        params: any[];
    }): { joinSql: string; selectCols: string; includeMeta: NonNullable<QueryResult['includeMeta']> } {
        const { includes, sourceModel, parentAlias, parentPath, params } = args;
        let joinSql = '';
        let selectCols = '';
        const includeMeta: NonNullable<QueryResult['includeMeta']> = [];

        includes.forEach((inc: IncludeOptions) => {
            const association = sourceModel
                ? findAssociation(sourceModel, {
                    association: inc.association,
                    as: inc.as,
                    model: inc.model
                })
                : undefined;

            const rawAlias = inc.as || association?.as || `J${this.joinAliasCounter + 1}`;
            const path = [...parentPath, rawAlias];
            const joinType = inc.required ? 'INNER JOIN' : 'LEFT JOIN';

            if (association?.type === 'belongsToMany') {
                if (!association.through || !association.otherKey) {
                    throw new Error('belongsToMany: associação inválida (through/otherKey).');
                }
                const throughModel = association.through as ModelStatic;
                const targetModel = association.target as ModelStatic;
                const throughTableName = this.resolveTableName(throughModel);
                const targetTableName = this.resolveTableName(targetModel);

                const throughJoinAlias = this.nextJoinAlias(`${rawAlias}_th`);
                joinSql += ` ${joinType} ${throughTableName} ${throughJoinAlias} ON ${parentAlias}.${sanitizeIdentifier(association.sourceKey, 'column')} = ${throughJoinAlias}.${sanitizeIdentifier(association.foreignKey, 'column')}`;

                if (inc.through?.where) {
                    const throughWhereB = WhereBuilder.build(inc.through.where, throughJoinAlias);
                    if (throughWhereB.sql) {
                        joinSql += ` AND ${throughWhereB.sql.replace(/^ WHERE /, '')}`;
                        params.push(...throughWhereB.params);
                    }
                }

                const targetJoinAlias = this.nextJoinAlias(rawAlias);
                joinSql += ` ${joinType} ${targetTableName} ${targetJoinAlias} ON ${throughJoinAlias}.${sanitizeIdentifier(association.otherKey, 'column')} = ${targetJoinAlias}.${sanitizeIdentifier(association.targetKey, 'column')}`;

                if (inc.where) {
                    const includeWhere = WhereBuilder.build(inc.where, targetJoinAlias);
                    if (includeWhere.sql) {
                        joinSql += ` AND ${includeWhere.sql.replace(/^ WHERE /, '')}`;
                        params.push(...includeWhere.params);
                    }
                }

                let projectedAttributes = inc.attributes;
                if (!projectedAttributes && targetModel?.schema) {
                    projectedAttributes = Object.keys(targetModel.schema);
                }

                if (projectedAttributes?.length) {
                    const cols = projectedAttributes.map((a: string) => {
                        const safeColumn = sanitizeIdentifier(a, 'column');
                        return `${targetJoinAlias}.${safeColumn} AS ${targetJoinAlias}__${safeColumn}`;
                    }).join(', ');
                    selectCols += `, ${cols}`;
                } else {
                    selectCols += `, ${targetJoinAlias}.*`;
                }

                const btmTargetPk = (targetModel as any)?.primaryKey || 'ID';
                includeMeta.push({
                    as: rawAlias,
                    path,
                    sqlAlias: targetJoinAlias,
                    attributes: projectedAttributes?.map((a: string) => sanitizeIdentifier(a, 'column')) || [],
                    type: 'many',
                    dedupeBy: sanitizeIdentifier(btmTargetPk, 'column')
                });

                const nestedIncs = inc.include
                    ? (Array.isArray(inc.include) ? inc.include : [inc.include])
                    : [];
                if (nestedIncs.length) {
                    const nested = this.buildIncludesRecursive({
                        includes: nestedIncs,
                        sourceModel: targetModel,
                        parentAlias: targetJoinAlias,
                        parentPath: path,
                        params
                    });
                    joinSql += nested.joinSql;
                    selectCols += nested.selectCols;
                    includeMeta.push(...nested.includeMeta);
                }
                return;
            }

            const joinAlias = this.nextJoinAlias(rawAlias);

            const joinTableName = association
                ? this.resolveTableName(association.target as ModelStatic)
                : (inc.model
                    ? this.resolveTableName(inc.model)
                    : sanitizeIdentifier(inc.table || '', 'table'));

            let leftColumn = inc.on?.[0];
            let rightColumn = inc.on?.[1];

            if (!leftColumn || !rightColumn) {
                if (!association) {
                    throw new Error(
                        `Include inválido: informe "on" ou uma associação cadastrada para "${rawAlias}".`
                    );
                }

                if (association.type === 'belongsTo') {
                    leftColumn = association.foreignKey;
                    rightColumn = association.targetKey;
                } else {
                    leftColumn = association.sourceKey;
                    rightColumn = association.foreignKey;
                }
            }

            joinSql += ` ${joinType} ${joinTableName} ${joinAlias} ON ${parentAlias}.${sanitizeIdentifier(leftColumn, 'column')} = ${joinAlias}.${sanitizeIdentifier(rightColumn, 'column')}`;

            if (inc.where) {
                const includeWhere = WhereBuilder.build(inc.where, joinAlias);
                if (includeWhere.sql) {
                    joinSql += ` AND ${includeWhere.sql.replace(/^ WHERE /, '')}`;
                    params.push(...includeWhere.params);
                }
            }

            let projectedAttributes = inc.attributes;
            const includeModel = (association?.target as ModelStatic | undefined) || inc.model;
            if (!projectedAttributes && includeModel?.schema) {
                projectedAttributes = Object.keys(includeModel.schema);
            }

            if (projectedAttributes?.length) {
                const cols = projectedAttributes.map((a: string) => {
                    const safeColumn = sanitizeIdentifier(a, 'column');
                    return `${joinAlias}.${safeColumn} AS ${joinAlias}__${safeColumn}`;
                }).join(', ');
                selectCols += `, ${cols}`;
            } else {
                selectCols += `, ${joinAlias}.*`;
            }

            const isMany = association?.type === 'hasMany';
            const childPk = isMany ? (includeModel as any)?.primaryKey || 'ID' : null;
            includeMeta.push({
                as: rawAlias,
                path,
                sqlAlias: joinAlias,
                attributes: projectedAttributes?.map((a: string) => sanitizeIdentifier(a, 'column')) || [],
                type: isMany ? 'many' : 'single',
                ...(isMany && childPk
                    ? { dedupeBy: sanitizeIdentifier(String(childPk), 'column') as string }
                    : {})
            });

            const nestedIncs = inc.include
                ? (Array.isArray(inc.include) ? inc.include : [inc.include])
                : [];
            if (nestedIncs.length) {
                const nested = this.buildIncludesRecursive({
                    includes: nestedIncs,
                    sourceModel: includeModel,
                    parentAlias: joinAlias,
                    parentPath: path,
                    params
                });
                joinSql += nested.joinSql;
                selectCols += nested.selectCols;
                includeMeta.push(...nested.includeMeta);
            }
        });

        return { joinSql, selectCols, includeMeta };
    }

    private static nextJoinAlias(rawAlias: string): string {
        this.joinAliasCounter += 1;
        const cleaned = rawAlias.replace(/[^A-Za-z0-9_]/g, '_') || 'J';
        return sanitizeIdentifier(`J${this.joinAliasCounter}_${cleaned}`, 'join alias');
    }
}