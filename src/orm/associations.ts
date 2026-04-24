import { Op } from './operators';

export type AssociationType = 'hasOne' | 'belongsTo' | 'hasMany' | 'belongsToMany';

export type ModelStaticLike = {
    tableName: string;
    primaryKey?: string;
    name?: string;
};

export interface AssociationOptions {
    as?: string;
    foreignKey?: string;
    sourceKey?: string;
    targetKey?: string;
}

/** Opções de `Model.belongsToMany(Other, { through, ... })` */
export interface BelongsToManyOptions {
    /** Model da tabela de junção (N:N). */
    through: ModelStaticLike;
    as?: string;
    /** Coluna em `through` que referencia a chave de **source** (lado de quem chama). */
    foreignKey?: string;
    /** Coluna em `through` que referencia a chave de **target**. */
    otherKey?: string;
    sourceKey?: string;
    targetKey?: string;
}

export interface AssociationDefinition {
    type: AssociationType;
    as: string;
    source: ModelStaticLike;
    target: ModelStaticLike;
    foreignKey: string;
    sourceKey: string;
    targetKey: string;
    /** Só `belongsToMany`: model da tabela de ligação. */
    through?: ModelStaticLike;
    /** Só `belongsToMany`: FK em `through` apontando para `target[ targetKey ]`. */
    otherKey?: string;
}

const associationsBySource = new Map<ModelStaticLike, AssociationDefinition[]>();
const MIXIN_FLAG = Symbol('orm_association_mixins');

function defaultAlias(target: ModelStaticLike, type: AssociationType): string {
    const base = (target.name || target.tableName || 'relation').toLowerCase();
    if (type === 'hasMany') return base.endsWith('s') ? base : `${base}s`;
    return base;
}

function defaultForeignKey(type: AssociationType, source: ModelStaticLike, target: ModelStaticLike, sourcePk: string, targetPk: string): string {
    if (type === 'belongsTo') {
        return `${target.tableName}_${targetPk}`.toUpperCase();
    }
    return `${source.tableName}_${sourcePk}`.toUpperCase();
}

function defaultBtmOtherKey(target: ModelStaticLike, targetPk: string): string {
    return `${target.tableName}_${targetPk}`.toUpperCase();
}

function toPascalCase(value: string): string {
    return value
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function singularize(value: string): string {
    return value.endsWith('s') ? value.slice(0, -1) : value;
}

function installMixins(source: any, association: AssociationDefinition): void {
    if (!source?.prototype) return;
    if (!source.prototype[MIXIN_FLAG]) source.prototype[MIXIN_FLAG] = new Set<string>();

    const mixins = source.prototype[MIXIN_FLAG] as Set<string>;
    const aliasPascal = toPascalCase(association.as);
    const singularPascal = toPascalCase(singularize(association.as));
    const target = association.target as any;

    const defineMixin = (name: string, fn: Function) => {
        if (mixins.has(name)) return;
        Object.defineProperty(source.prototype, name, {
            value: fn,
            enumerable: false
        });
        mixins.add(name);
    };

    if (association.type === 'belongsTo') {
        defineMixin(`get${aliasPascal}`, async function (this: any, options: any = {}) {
            const fk = this.dataValues?.[association.foreignKey];
            if (fk === undefined || fk === null) return null;
            return target.findOne({
                ...options,
                where: {
                    ...(options.where || {}),
                    [association.targetKey]: fk
                }
            });
        });

        defineMixin(`set${aliasPascal}`, async function (this: any, value: any, options: any = {}) {
            const targetValue = value?.dataValues?.[association.targetKey] ?? value;
            this.dataValues[association.foreignKey] = targetValue;
            return this.save(options);
        });
        return;
    }

    if (association.type === 'hasOne') {
        defineMixin(`get${aliasPascal}`, async function (this: any, options: any = {}) {
            return target.findOne({
                ...options,
                where: {
                    ...(options.where || {}),
                    [association.foreignKey]: this.dataValues?.[association.sourceKey]
                }
            });
        });

        defineMixin(`set${aliasPascal}`, async function (this: any, value: any, options: any = {}) {
            if (!value) return null;
            value.dataValues[association.foreignKey] = this.dataValues?.[association.sourceKey];
            return value.save(options);
        });
        return;
    }

    defineMixin(`get${aliasPascal}`, async function (this: any, options: any = {}) {
        return target.findAll({
            ...options,
            where: {
                ...(options.where || {}),
                [association.foreignKey]: this.dataValues?.[association.sourceKey]
            }
        });
    });

    defineMixin(`count${aliasPascal}`, async function (this: any, options: any = {}) {
        return target.count({
            ...options,
            where: {
                ...(options.where || {}),
                [association.foreignKey]: this.dataValues?.[association.sourceKey]
            }
        });
    });

    defineMixin(`add${singularPascal}`, async function (this: any, value: any, options: any = {}) {
        if (!value) return null;
        value.dataValues[association.foreignKey] = this.dataValues?.[association.sourceKey];
        return value.save(options);
    });
}

function installBelongsToManyMixins(source: any, association: AssociationDefinition) {
    if (!source?.prototype) return;
    if (!source.prototype[MIXIN_FLAG]) source.prototype[MIXIN_FLAG] = new Set<string>();
    const mixins = source.prototype[MIXIN_FLAG] as Set<string>;
    const target = association.target as any;
    const Through = association.through as any;
    const aliasPascal = toPascalCase(association.as);
    const singularPascal = toPascalCase(singularize(association.as));
    const fk = association.foreignKey;
    const other = association.otherKey as string;
    const sk = association.sourceKey;
    const tk = association.targetKey;

    const defineMixin = (name: string, fn: Function) => {
        if (mixins.has(name)) return;
        Object.defineProperty(source.prototype, name, { value: fn, enumerable: false });
        mixins.add(name);
    };

    const passTx = (o: any) => ({
        transaction: o?.transaction,
        logging: o?.logging,
        benchmark: o?.benchmark
    });

    defineMixin(`get${aliasPascal}`, async function (this: any, options: any = {}) {
        const srcId = this.dataValues?.[sk];
        if (srcId === undefined || srcId === null) return [];
        const tw = options.throughWhere || options.junctionWhere;
        const links = await Through.findAll({
            where: { [fk]: srcId, ...(tw && typeof tw === 'object' ? tw : {}) },
            ...passTx(options)
        });
        const tids = links.map((r: any) => (r.dataValues || r)[other]).filter((x: any) => x != null);
        if (!tids.length) return [];
        return target.findAll({
            where: { ...(options.where || {}), [tk]: { [Op.in]: tids } },
            include: options.include,
            attributes: options.attributes,
            order: options.order,
            limit: options.limit,
            offset: options.offset,
            ...passTx(options)
        });
    });

    defineMixin(`count${aliasPascal}`, async function (this: any, options: any = {}) {
        const srcId = this.dataValues?.[sk];
        if (srcId === undefined || srcId === null) return 0;
        const tw = options.throughWhere || options.junctionWhere;
        return Through.count({
            where: { [fk]: srcId, ...(tw && typeof tw === 'object' ? tw : {}) },
            ...passTx(options)
        });
    });

    defineMixin(`add${singularPascal}`, async function (this: any, value: any, options: any = {}) {
        if (!value) return null;
        const tid = value.dataValues?.[tk] ?? value[tk];
        if (tid === undefined || tid === null) {
            throw new Error(`belongsToMany.add: o model alvo precisa de "${tk}".`);
        }
        return Through.create(
            { [fk]: this.dataValues[sk], [other]: tid } as any,
            passTx(options) as any
        );
    });

    defineMixin(`remove${singularPascal}`, async function (this: any, value: any, options: any = {}) {
        if (!value) return 0;
        const tid = value.dataValues?.[tk] ?? value[tk];
        if (tid === null || tid === undefined) return 0;
        return Through.destroy({
            where: { [fk]: this.dataValues[sk], [other]: tid } as any,
            ...passTx(options)
        });
    });

    defineMixin(`set${aliasPascal}`, async function (this: any, values: any[] | null, options: any = {}) {
        const srcId = this.dataValues[sk];
        if (srcId === null || srcId === undefined) {
            throw new Error('belongsToMany.set: chave de origem ausente na instância.');
        }
        await Through.destroy({ where: { [fk]: srcId } as any, ...passTx(options) });
        if (!values?.length) return this;
        for (const v of values) {
            const tid = v?.dataValues?.[tk] ?? v?.[tk];
            if (tid != null) {
                await Through.create(
                    { [fk]: srcId, [other]: tid } as any,
                    passTx(options) as any
                );
            }
        }
        return this;
    });

    defineMixin(`has${singularPascal}`, async function (this: any, value: any, options: any = {}) {
        const tid = value?.dataValues?.[tk] ?? value?.[tk];
        if (tid == null) return false;
        const c = await Through.count({
            where: { [fk]: this.dataValues[sk], [other]: tid } as any,
            ...passTx(options)
        });
        return c > 0;
    });
}

export function registerBelongsToMany(
    source: ModelStaticLike,
    target: ModelStaticLike,
    options: BelongsToManyOptions
): AssociationDefinition {
    if (!options.through) {
        throw new Error('belongsToMany: a opção `through` (model da tabela de junção) é obrigatória.');
    }
    const through = options.through;
    const sourcePk = (options.sourceKey || source.primaryKey || 'ID').toString();
    const targetPk = (options.targetKey || target.primaryKey || 'ID').toString();
    const fk = (options.foreignKey || defaultForeignKey('hasMany', source, through, sourcePk, targetPk)).toUpperCase();
    const other = (options.otherKey || defaultBtmOtherKey(target, targetPk)).toUpperCase();

    const association: AssociationDefinition = {
        type: 'belongsToMany',
        as: options.as || defaultAlias(target, 'hasMany'),
        source,
        target,
        through,
        foreignKey: fk,
        otherKey: other,
        sourceKey: sourcePk.toUpperCase(),
        targetKey: targetPk.toUpperCase()
    };

    const list = associationsBySource.get(source) || [];
    const existing = list.findIndex((item) => item.as === association.as);

    if (existing >= 0) {
        list[existing] = association;
    } else {
        list.push(association);
    }

    associationsBySource.set(source, list);
    installBelongsToManyMixins(source as any, association);
    return association;
}

export function registerAssociation(
    type: Exclude<AssociationType, 'belongsToMany'>,
    source: ModelStaticLike,
    target: ModelStaticLike,
    options: AssociationOptions = {}
): AssociationDefinition {
    const sourcePk = options.sourceKey || source.primaryKey || 'ID';
    const targetPk = options.targetKey || target.primaryKey || 'ID';
    const computedForeignKey = defaultForeignKey(type, source, target, sourcePk, targetPk);

    const association: AssociationDefinition = {
        type,
        as: options.as || defaultAlias(target, type),
        source,
        target,
        foreignKey: (options.foreignKey || computedForeignKey).toUpperCase(),
        sourceKey: sourcePk.toUpperCase(),
        targetKey: targetPk.toUpperCase()
    };

    const list = associationsBySource.get(source) || [];
    const existing = list.findIndex((item) => item.as === association.as);

    if (existing >= 0) {
        list[existing] = association;
    } else {
        list.push(association);
    }

    associationsBySource.set(source, list);
    installMixins(source, association);
    return association;
}

export function getAssociations(source: ModelStaticLike): AssociationDefinition[] {
    return associationsBySource.get(source) || [];
}

export function findAssociation(
    source: ModelStaticLike,
    options: { as?: string; model?: ModelStaticLike; association?: string } = {}
): AssociationDefinition | undefined {
    const list = getAssociations(source);

    if (options.association) {
        return list.find((item) => item.as === options.association);
    }

    if (options.as) {
        return list.find((item) => item.as === options.as);
    }

    if (options.model) {
        return list.find((item) => item.target === options.model);
    }

    return undefined;
}
