import type { ColumnOptions } from './data-types';
import { getAssociations, registerAssociation, type ModelStaticLike } from './associations';
import type { Model } from './model';

const asLike = (M: any): ModelStaticLike => M as ModelStaticLike;

export type OrmWithModels = {
    models: Record<string, typeof Model>;
};

function snakeToCamel(s: string): string {
    const parts = s
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter(Boolean);
    if (!parts.length) return s;
    return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function nextUniqueAs(used: Set<string>, base: string): string {
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    let n = 2;
    let candidate = `${base}${n}`;
    while (used.has(candidate)) {
        n += 1;
        candidate = `${base}${n}`;
    }
    used.add(candidate);
    return candidate;
}

function collectTakenAs(M: any): Set<string> {
    return new Set(getAssociations(M as ModelStaticLike).map((a) => a.as));
}

function hasBelongsToWithSameFk(
    source: ModelStaticLike,
    target: ModelStaticLike,
    foreignKey: string
): boolean {
    const fk = foreignKey.toUpperCase();
    return getAssociations(source).some(
        (a) => a.type === 'belongsTo' && a.target === target && a.foreignKey === fk
    );
}

function hasHasManyWithSameFk(
    source: ModelStaticLike,
    target: ModelStaticLike,
    foreignKey: string
): boolean {
    const fk = foreignKey.toUpperCase();
    return getAssociations(source).some(
        (a) => a.type === 'hasMany' && a.target === target && a.foreignKey === fk
    );
}

function hasHasOneWithSameFk(
    source: ModelStaticLike,
    target: ModelStaticLike,
    foreignKey: string
): boolean {
    const fk = foreignKey.toUpperCase();
    return getAssociations(source).some(
        (a) => a.type === 'hasOne' && a.target === target && a.foreignKey === fk
    );
}

function defaultHasManyAliasFromChild(child: any): string {
    const base = (child.modelName || child.name || child.tableName || 'item').toString().toLowerCase();
    return base.endsWith('s') ? base : `${base}s`;
}

/** Nome sugerido 1:1 a partir de `modelName` / tabela (singular). */
function defaultHasOneAliasFromChild(child: any): string {
    let base = (child.modelName || child.name || child.tableName || 'item').toString().toLowerCase();
    if (base.endsWith('s') && base.length > 1) base = base.slice(0, -1);
    return base || 'item';
}

function suggestHasManyAs(parent: any, child: any, foreignKey: string, targetKey: string): string {
    const taken = collectTakenAs(parent);
    const base = defaultHasManyAliasFromChild(child);
    if (!taken.has(base)) {
        taken.add(base);
        return base;
    }
    const tk = targetKey.toUpperCase();
    const fkU = foreignKey.toUpperCase();
    const stem = fkU.endsWith(`_${tk}`) ? foreignKey.slice(0, -(tk.length + 1)) : foreignKey;
    const extra = snakeToCamel(
        stem
            .replace(/[^A-Za-z0-9_]+/g, '_')
            .replace(/^_+|_+$/g, '')
    );
    const pascalExtra = extra ? extra.charAt(0).toUpperCase() + extra.slice(1) : 'Alt';
    let candidate = `${base}As${pascalExtra}`;
    if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
    }
    let n = 2;
    while (taken.has(`${base}${n}`)) n += 1;
    candidate = `${base}${n}`;
    taken.add(candidate);
    return candidate;
}

function suggestHasOneAs(parent: any, child: any, foreignKey: string, targetKey: string): string {
    const taken = collectTakenAs(parent);
    const base = defaultHasOneAliasFromChild(child);
    if (!taken.has(base)) {
        taken.add(base);
        return base;
    }
    const tk = targetKey.toUpperCase();
    const fkU = foreignKey.toUpperCase();
    const stem = fkU.endsWith(`_${tk}`) ? foreignKey.slice(0, -(tk.length + 1)) : foreignKey;
    const extra = snakeToCamel(
        stem
            .replace(/[^A-Za-z0-9_]+/g, '_')
            .replace(/^_+|_+$/g, '')
    );
    const pascalExtra = extra ? extra.charAt(0).toUpperCase() + extra.slice(1) : 'Alt';
    let candidate = `${base}As${pascalExtra}`;
    if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
    }
    let n = 2;
    while (taken.has(`${base}${n}`)) n += 1;
    candidate = `${base}${n}`;
    taken.add(candidate);
    return candidate;
}

function suggestBelongsToAs(foreignKey: string, targetKey: string, target: any): string {
    const tk = targetKey.toUpperCase();
    const fkU = foreignKey.toUpperCase();
    if (fkU.endsWith(`_${tk}`)) {
        const stem = fkU.slice(0, -(tk.length + 1));
        if (stem) return snakeToCamel(stem);
    }
    const raw = (target.modelName || target.name || target.tableName || 'related') as string;
    const lower = raw.charAt(0).toLowerCase() + raw.slice(1);
    return lower.replace(/^_+/, '') || 'related';
}

function nextBelongsToAs(source: any, base: string): string {
    const used = collectTakenAs(source);
    return nextUniqueAs(used, base);
}

/**
 * Encontra o model registado a partir de `references.model` (string normalizado no `init`)
 * ou compara com `tableName` / `modelName`.
 */
export function resolveReferencedModel(orm: OrmWithModels, ref: string | undefined | null): typeof Model | undefined {
    if (ref == null || ref === '') return undefined;
    if (orm.models[ref]) return orm.models[ref] as typeof Model;

    const refUpper = ref.toString().toUpperCase();
    const seen = new Set<typeof Model>();
    for (const M of Object.values(orm.models)) {
        if (!M || seen.has(M)) continue;
        seen.add(M);
        const table = (M as any).tableName;
        if (table && String(table).toUpperCase() === refUpper) return M as typeof Model;
        const mname = (M as any).modelName;
        if (mname && mname === ref) return M as typeof Model;
    }
    return undefined;
}

function eachRegisteredModel(orm: OrmWithModels): typeof Model[] {
    const out: typeof Model[] = [];
    const seen = new Set<typeof Model>();
    for (const M of Object.values(orm.models)) {
        if (!M || seen.has(M)) continue;
        seen.add(M);
        out.push(M);
    }
    return out;
}

/**
 * Cria `belongsTo` a partir de cada coluna com `references` e, no alvo, `hasOne` (FK com `unique: true`) ou
 * `hasMany` inverso. Idempotente: ignora pares (modelo, FK) já presentes. Volte a chamar após registrar novos models.
 */
export function wireReferenceAssociations(orm: OrmWithModels): void {
    const models = eachRegisteredModel(orm);

    for (const source of models) {
        const schema = (source as any).schema as Record<string, ColumnOptions> | undefined;
        if (!schema) continue;

        for (const [columnName, col] of Object.entries(schema)) {
            const ref = col.references;
            if (!ref) continue;

            const targetKey = (ref.key || 'ID').toString();
            const modelRef = ref.model;
            if (typeof modelRef !== 'string' || !modelRef.trim()) continue;

            const target = resolveReferencedModel(orm, modelRef.trim());
            if (!target) continue;

            const fk = columnName.toUpperCase();

            if (!hasBelongsToWithSameFk(asLike(source), asLike(target), fk)) {
                const as = nextBelongsToAs(
                    source,
                    suggestBelongsToAs(columnName, targetKey, target)
                );
                registerAssociation('belongsTo', source as any, target as any, {
                    as,
                    foreignKey: fk,
                    targetKey: targetKey.toUpperCase()
                });
            }

            const isUnique = !!col.unique;
            if (isUnique) {
                if (!hasHasOneWithSameFk(asLike(target), asLike(source), fk) && !hasHasManyWithSameFk(asLike(target), asLike(source), fk)) {
                    const hasOneAs = suggestHasOneAs(target, source, columnName, targetKey);
                    registerAssociation('hasOne', target as any, source as any, {
                        as: hasOneAs,
                        foreignKey: fk,
                        sourceKey: targetKey.toUpperCase()
                    });
                }
            } else {
                if (!hasHasOneWithSameFk(asLike(target), asLike(source), fk) && !hasHasManyWithSameFk(asLike(target), asLike(source), fk)) {
                    const hasManyAs = suggestHasManyAs(target, source, columnName, targetKey);
                    registerAssociation('hasMany', target as any, source as any, {
                        as: hasManyAs,
                        foreignKey: fk,
                        sourceKey: targetKey.toUpperCase()
                    });
                }
            }
        }
    }
}
