import { findAssociation, type AssociationDefinition } from '../associations';
import { Op } from '../operators';
import type { IncludeOptions, ModelStatic, QueryOptions, SeparateIncludePlan } from './types';

function normalizeIncludeList(include?: IncludeOptions | IncludeOptions[]): IncludeOptions[] {
    if (!include) return [];
    return (Array.isArray(include) ? include : [include]) as IncludeOptions[];
}

/**
 * Tipo de ligação: associação registrada, ou `separateType`, ou padrão `hasMany` para `on` puro
 * (p→f `on[0]` = chave do pai, `on[1]` = FK no filho).
 */
function inferLinkKind(
    ass: AssociationDefinition | undefined,
    on: [string, string] | undefined,
    inc: IncludeOptions
): 'hasMany' | 'hasOne' | 'belongsTo' | 'belongsToMany' {
    if (ass) {
        if (ass.type === 'belongsTo') return 'belongsTo';
        if (ass.type === 'hasOne') return 'hasOne';
        if (ass.type === 'hasMany') return 'hasMany';
        if (ass.type === 'belongsToMany') return 'belongsToMany';
    }
    if (inc.separateType) {
        return inc.separateType;
    }
    if (on) {
        return 'hasMany';
    }
    return 'hasMany';
}

function separateEligible(association: AssociationDefinition | undefined, inc: IncludeOptions): boolean {
    if (!inc.separate) return false;
    if (association) {
        if (['hasMany', 'hasOne', 'belongsTo', 'belongsToMany'].includes(association.type)) return true;
        throw new Error(`include.separate: tipo "${(association as any).type}" não suportado.`);
    }
    if (inc.model && inc.on) return true;
    throw new Error(
        'include.separate: informe `association` registrada, ou (model + on) para JOIN manual.'
    );
}

/**
 * Remove includes `separate: true` da árvore de JOIN; acumula em `separateOut` para
 * fase pós-SELECT com `IN (...)`.
 */
export function splitJoinIncludesAndCollectSeparatePlans(
    includes: IncludeOptions[],
    sourceModel: ModelStatic | undefined,
    pathToSource: string[],
    separateOut: SeparateIncludePlan[]
): IncludeOptions[] {
    const res: IncludeOptions[] = [];
    for (const inc of includes) {
        if (!sourceModel) {
            if (inc.separate) {
                throw new Error('include: `separate` requer model na raiz (tabela) para resolver associação.');
            }
        }
        const association = sourceModel
            ? findAssociation(sourceModel, {
                association: inc.association,
                as: inc.as,
                model: inc.model
            })
            : undefined;

        const targetModel = (association?.target as ModelStatic | undefined) || inc.model;
        const rawAs = (inc.as || association?.as || 'rel') as string;

        if (separateEligible(association, inc)) {
            if (!targetModel) {
                throw new Error(`include.separate: defina o model alvo para "${rawAs}"`);
            }
            const linkKind = inferLinkKind(association, inc.on, inc);
            separateOut.push({
                pathToSource: pathToSource.slice(),
                as: rawAs,
                association: association || null,
                node: { ...inc },
                sourceModel: sourceModel!,
                targetModel: targetModel as ModelStatic,
                linkKind
            });
            continue;
        }

        const ch = normalizeIncludeList(inc.include);
        const nextSource = (association?.target as ModelStatic) || inc.model;
        const nextPath = pathToSource.concat([rawAs]);
        const nested = ch.length
            ? splitJoinIncludesAndCollectSeparatePlans(ch, nextSource, nextPath, separateOut)
            : [];
        res.push({ ...inc, include: nested.length ? nested : undefined } as IncludeOptions);
    }
    return res;
}

function getValue(obj: any, key: string): any {
    if (obj == null) return undefined;
    if (typeof obj === 'object' && 'dataValues' in obj && obj.dataValues && key in obj.dataValues) {
        return obj.dataValues[key];
    }
    return obj[key];
}

/** Objetos “âncora” alinhando `path` (cada `as` pode ser hasMany: array de filhos). */
export function getAnchorObjects(rows: any[], pathToSource: string[]): any[] {
    if (pathToSource.length === 0) return rows || [];
    let acc: any[] = (rows || []).filter(Boolean);
    for (const key of pathToSource) {
        const next: any[] = [];
        for (const r of acc) {
            if (r == null) continue;
            const v = getValue(r, key);
            if (v == null) continue;
            if (Array.isArray(v)) {
                for (const x of v) if (x != null) next.push(x);
            } else {
                next.push(v);
            }
        }
        acc = next;
    }
    return acc;
}

type KeyPlan =
    | { keys: any[]; filterColumn: string; sourceKey: string; linkKind: 'hasMany' | 'hasOne' | 'belongsTo' }
    | { keys: any[]; sourceKey: string; linkKind: 'belongsToMany' };

function buildKeyPlan(plan: SeparateIncludePlan, anchors: any[]): KeyPlan {
    const ass = plan.association;
    const on = plan.node.on;
    if (ass) {
        if (ass.type === 'belongsToMany') {
            return {
                keys: anchors.map((o) => getValue(o, ass.sourceKey)).filter((v) => v != null),
                sourceKey: ass.sourceKey,
                linkKind: 'belongsToMany'
            };
        }
        if (ass.type === 'belongsTo') {
            return {
                keys: anchors.map((o) => getValue(o, ass.foreignKey)).filter((v) => v != null),
                filterColumn: ass.targetKey,
                sourceKey: ass.foreignKey,
                linkKind: 'belongsTo'
            };
        }
        if (ass.type === 'hasMany' || ass.type === 'hasOne') {
            return {
                keys: anchors.map((o) => getValue(o, ass.sourceKey)).filter((v) => v != null),
                filterColumn: ass.foreignKey,
                sourceKey: ass.sourceKey,
                linkKind: ass.type === 'hasOne' ? 'hasOne' : 'hasMany'
            };
        }
    }
    if (on) {
        const k = plan.linkKind;
        if (k === 'belongsTo') {
            return {
                keys: anchors.map((o) => getValue(o, on[0])).filter((v) => v != null),
                filterColumn: on[1],
                sourceKey: on[0],
                linkKind: 'belongsTo'
            };
        }
        return {
            keys: anchors.map((o) => getValue(o, on[0])).filter((v) => v != null),
            filterColumn: on[1],
            sourceKey: on[0],
            linkKind: k === 'hasOne' ? 'hasOne' : 'hasMany'
        };
    }
    throw new Error('include.separate: não foi possível obter chaves (associação ou "on" ausente).');
}

/**
 * Aplica fetches separados (por ordem de profundidade de `pathToSource`) mutando
 * o mesmo formato de `materializeIncludes` (objetos planos, antes de `new Model()`).
 */
export async function applySeparateFetches(
    rows: any[],
    plans: SeparateIncludePlan[],
    baseOptions: QueryOptions
): Promise<void> {
    if (!plans.length || !rows.length) return;
    const sorted = [...plans].sort((a, b) => a.pathToSource.length - b.pathToSource.length);
    const { transaction, logging, benchmark } = baseOptions;
    for (const plan of sorted) {
        const node = plan.node;
        const Target = plan.targetModel as any;
        const anchors = getAnchorObjects(rows, plan.pathToSource);
        const kplan = buildKeyPlan(plan, anchors);
        const uniq = Array.from(new Set(kplan.keys));

        if (kplan.linkKind === 'belongsToMany') {
            if (uniq.length === 0) {
                for (const a of getAnchorObjects(rows, plan.pathToSource)) a[plan.as] = [];
                continue;
            }
            const ass = plan.association;
            if (!ass || ass.type !== 'belongsToMany' || !ass.through || !ass.otherKey) {
                throw new Error('include.separate: belongsToMany requer associação com through e otherKey.');
            }
            const inClauseB = { [Op.in]: uniq } as any;
            const tw = node.through?.where;
            const wThrough: Record<string | symbol, any> = { [ass.foreignKey]: inClauseB, ...(tw || {}) };
            const pass = { transaction, logging, benchmark };
            const Through = ass.through as any;
            const links = (await Through.findAll({ where: wThrough, ...pass })) as any[];
            const tk = ass.targetKey;
            const fk = ass.foreignKey;
            const other = ass.otherKey;
            const sk = ass.sourceKey;
            const tids: any[] = [];
            const seenT = new Set<string>();
            for (const l of links) {
                const tid = getValue(l, other);
                if (tid == null) continue;
                const t = String(tid);
                if (seenT.has(t)) continue;
                seenT.add(t);
                tids.push(tid);
            }
            if (tids.length === 0) {
                for (const a of getAnchorObjects(rows, plan.pathToSource)) a[plan.as] = [];
                continue;
            }
            const tIn = { [Op.in]: tids } as any;
            const wTarget: Record<string | symbol, any> = { [tk]: tIn, ...(node.where || {}) };
            const subIncsB = normalizeIncludeList(node.include);
            const listB = (await Target.findAll({
                where: wTarget,
                include: subIncsB.length ? subIncsB : undefined,
                attributes: node.attributes,
                order: node.order,
                limit: node.limit,
                offset: node.offset,
                ...pass
            })) as any[];
            const byTid = new Map<string, any>();
            for (const row of listB) {
                byTid.set(String(getValue(row, tk)), row);
            }
            const byParent = new Map<string, any[]>();
            for (const link of links) {
                const pid = getValue(link, fk);
                const tid = getValue(link, other);
                if (pid == null || tid == null) continue;
                const row = byTid.get(String(tid));
                if (!row) continue;
                const ps = String(pid);
                if (!byParent.has(ps)) byParent.set(ps, []);
                const arr = byParent.get(ps)!;
                if (arr.some((r) => String(getValue(r, tk)) === String(tid))) continue;
                arr.push(row);
            }
            for (const p of getAnchorObjects(rows, plan.pathToSource)) {
                const sid = getValue(p, sk);
                p[plan.as] = sid != null ? byParent.get(String(sid)) || [] : [];
            }
            continue;
        }

        if (uniq.length === 0) {
            if (kplan.linkKind === 'hasMany') {
                for (const a of getAnchorObjects(rows, plan.pathToSource)) a[plan.as] = [];
            } else {
                for (const a of getAnchorObjects(rows, plan.pathToSource)) a[plan.as] = null;
            }
            continue;
        }
        const inClause = { [Op.in]: uniq } as any;
        const w: Record<string | symbol, any> = { [kplan.filterColumn]: inClause, ...(node.where || {}) };
        const subIncs = normalizeIncludeList(node.include);
        const childOptions: QueryOptions = {
            where: w,
            include: subIncs.length ? subIncs : undefined,
            attributes: node.attributes,
            order: node.order,
            limit: node.limit,
            offset: node.offset,
            transaction,
            logging,
            benchmark
        };
        const list = (await Target.findAll(childOptions)) as any[];
        const ass = plan.association;
        const fkOnChild = ass
            ? ass.type === 'hasMany' || ass.type === 'hasOne'
                ? ass.foreignKey
                : kplan.filterColumn
            : node.on
                ? node.on[1]!
                : kplan.filterColumn;
        if (kplan.linkKind === 'hasMany') {
            const by = new Map<string, any[]>();
            for (const row of list) {
                const fk = getValue(row, fkOnChild);
                const g = by.get(String(fk)) || [];
                g.push(row);
                by.set(String(fk), g);
            }
            for (const p of getAnchorObjects(rows, plan.pathToSource)) {
                const sid = getValue(p, kplan.sourceKey);
                p[plan.as] = by.get(String(sid)) || [];
            }
        } else if (kplan.linkKind === 'hasOne') {
            const by = new Map<string, any>();
            for (const row of list) {
                const fk = getValue(row, fkOnChild);
                if (!by.has(String(fk))) by.set(String(fk), row);
            }
            for (const p of getAnchorObjects(rows, plan.pathToSource)) {
                const sid = getValue(p, kplan.sourceKey);
                p[plan.as] = sid != null ? by.get(String(sid)) ?? null : null;
            }
        } else {
            const by = new Map<string, any>();
            for (const row of list) {
                by.set(String(getValue(row, kplan.filterColumn)), row);
            }
            for (const p of getAnchorObjects(rows, plan.pathToSource)) {
                const sid = getValue(p, kplan.sourceKey);
                p[plan.as] = sid != null ? by.get(String(sid)) ?? null : null;
            }
        }
    }
}
