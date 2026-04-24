import { QueryBuilder, QueryOptions } from './query-builder';
import { ColumnOptions, DataTypeDefinition, DataTypeInput, isTextType } from './data-types';
import type * as Firebird from 'node-firebird';
import { registerAssociation, registerBelongsToMany, AssociationOptions, BelongsToManyOptions } from './associations';
import { IncludeProjectionMeta, ScopeMap } from './query/types';
import { applySeparateFetches } from './query/include-separate';
import { ValidationError } from './errors';
import { runValidateEntry } from './validators';
import type { SyncOptions, SyncResult } from './schema/types';
import type { OriusORMForSync } from './schema/sync';

export abstract class Model {
    protected static tableName: string;
    protected static primaryKey: string = 'ID';
    protected static schema: Record<string, ColumnOptions> = {};
    protected static connection: any;
    protected static defaultScope: QueryOptions = {};
    protected static scopes: ScopeMap = {};
    protected static hooks: Partial<Record<HookName, HookHandler[]>> = {};
    protected static globalHooks: Partial<Record<HookName, HookHandler[]>> = {};
    protected static modelOptions: ModelInitOptions = {};

    public dataValues: any = {};
    protected _previousDataValues: any = {};
    public isNewRecord = true;

    constructor(values: any = {}, options: InstanceOptions = {}) {
        this.isNewRecord = options.isNewRecord ?? true;
        const modelClass = this.constructor as typeof Model;
        const schema = (modelClass as any).schema || {};
        const withDefaults = { ...values };

        for (const [key, column] of Object.entries<ColumnOptions>(schema)) {
            if (withDefaults[key] === undefined && column.defaultValue !== undefined) {
                withDefaults[key] = typeof column.defaultValue === 'function'
                    ? column.defaultValue()
                    : column.defaultValue;
            }
        }

        this.dataValues = withDefaults;
        this._previousDataValues = { ...withDefaults };
    }

    public static setConnection(conn: any) {
        this.connection = conn;
    }

    public static init(attributes: Record<string, ColumnOptions>, options: ModelInitOptions = {}): typeof Model {
        const { orm, ...optionsWithoutOrm } = options;

        (this as any).schema = this.normalizeAttributes(attributes);
        (this as any).tableName = optionsWithoutOrm.tableName || (this as any).tableName || this.name.toUpperCase();
        (this as any).defaultScope = optionsWithoutOrm.defaultScope || {};
        (this as any).scopes = optionsWithoutOrm.scopes || {};
        (this as any).modelOptions = optionsWithoutOrm;

        if (optionsWithoutOrm.primaryKey) {
            (this as any).primaryKey = optionsWithoutOrm.primaryKey;
        } else {
            const explicitPk = Object.entries(attributes).find(([, col]) => col.primaryKey)?.[0];
            if (explicitPk) (this as any).primaryKey = explicitPk;
        }

        if (orm) {
            (this as any).orm = orm;
            (this as any).setConnection(orm.getConnection());
            orm.registerModel(this);
        }

        return this;
    }

    private static normalizeAttributes(attributes: Record<string, ColumnOptions>): Record<string, ColumnOptions> {
        const normalized: Record<string, ColumnOptions> = {};

        for (const [columnName, columnConfig] of Object.entries(attributes)) {
            const cloned: ColumnOptions = { ...columnConfig };

            if (cloned.references) {
                const modelRef = cloned.references.model as any;
                if (typeof modelRef !== 'string') {
                    cloned.references = {
                        ...cloned.references,
                        model: modelRef?.modelName || modelRef?.tableName || modelRef?.name || ''
                    };
                }
            }

            normalized[columnName] = cloned;
        }

        return normalized;
    }

    public static addHook(name: HookName, fn: HookHandler): void {
        const modelClass = this as any;
        modelClass.hooks = modelClass.hooks || {};
        modelClass.hooks[name] = modelClass.hooks[name] || [];
        modelClass.hooks[name].push(fn);
    }

    public static addGlobalHook(name: HookName, fn: HookHandler): void {
        const modelClass = this as any;
        modelClass.globalHooks = modelClass.globalHooks || {};
        modelClass.globalHooks[name] = modelClass.globalHooks[name] || [];
        modelClass.globalHooks[name].push(fn);
    }

    public static beforeCreate(fn: HookHandler): void { this.addHook('beforeCreate', fn); }
    public static afterCreate(fn: HookHandler): void { this.addHook('afterCreate', fn); }
    public static beforeUpdate(fn: HookHandler): void { this.addHook('beforeUpdate', fn); }
    public static afterUpdate(fn: HookHandler): void { this.addHook('afterUpdate', fn); }
    public static beforeSave(fn: HookHandler): void { this.addHook('beforeSave', fn); }
    public static afterSave(fn: HookHandler): void { this.addHook('afterSave', fn); }
    public static beforeDestroy(fn: HookHandler): void { this.addHook('beforeDestroy', fn); }
    public static afterDestroy(fn: HookHandler): void { this.addHook('afterDestroy', fn); }

    public static addScope(name: string, scope: QueryOptions | ((...args: any[]) => QueryOptions)): void {
        const modelClass = this as any;
        modelClass.scopes = modelClass.scopes || {};
        modelClass.scopes[name] = scope;
    }

    public static scope(...scopes: Array<string | [string, ...any[]]>): ScopedModel {
        const modelClass = this as any;
        const resolvedScopes = scopes.map((scopeEntry) => {
            if (Array.isArray(scopeEntry)) {
                const [name, ...args] = scopeEntry;
                const registered = modelClass.scopes?.[name];
                if (typeof registered === 'function') return registered(...args);
                return registered || {};
            }
            const registered = modelClass.scopes?.[scopeEntry];
            return typeof registered === 'function' ? registered() : (registered || {});
        });

        const mergedScope = resolvedScopes.reduce((acc: QueryOptions, scopeItem: QueryOptions) => {
            return {
                ...acc,
                ...scopeItem,
                where: { ...(acc.where || {}), ...(scopeItem.where || {}) }
            };
        }, {});

        return new ScopedModel(modelClass, mergedScope);
    }

    /**
     * Ignora o `defaultScope` para a operação encadeada (compatível com `Model.unscoped()` do Sequelize).
     */
    public static unscoped(): ScopedModel {
        return new ScopedModel(this as any, { ignoreDefaultScope: true });
    }

    public static hasOne(target: any, options: AssociationOptions = {}) {
        return registerAssociation('hasOne', this as any, target as any, options);
    }

    public static belongsTo(target: any, options: AssociationOptions = {}) {
        return registerAssociation('belongsTo', this as any, target as any, options);
    }

    public static hasMany(target: any, options: AssociationOptions = {}) {
        return registerAssociation('hasMany', this as any, target as any, options);
    }

    public static belongsToMany(target: any, options: BelongsToManyOptions) {
        return registerBelongsToMany(this as any, target as any, options);
    }

    /**
     * Sincroniza esta tabela com o banco (CREATE se faltar, depois FKs), no estilo `sequelize.sync`.
     * Exige `orm` em `Model.init(..., { orm })` ou `{ orm }` nas opções.
     */
    public static async sync(
        options?: SyncOptions & { orm?: OriusORMForSync }
    ): Promise<SyncResult> {
        const { syncModelWithOrm } = await import('./schema/sync');
        const orm = options?.orm ?? (this as any).orm;
        if (!orm) {
            throw new Error('Defina { orm } em sync({ orm }) ou use Model.init(attrs, { orm, ... }).');
        }
        const { orm: _ignore, ...rest } = options || {};
        return syncModelWithOrm(orm, this, rest);
    }

    /**
     * Busca o próximo valor de um Generator/Sequence no Firebird.
     * Útil para tabelas que não usam IDENTITY (comum em bancos legados).
     */
    protected static async getNextSequenceValue(sequenceName: string): Promise<number> {
        const result = await this.connection.execute(`SELECT NEXT VALUE FOR ${sequenceName.toUpperCase()} FROM RDB$DATABASE`);
        return result[0].NEXT_VALUE || result[0].NEXT;
    }

    /**
     * Converte BLOBs (streams) em Strings ou Buffers baseando-se no Schema.
     */
    protected static async hydrate(row: any): Promise<any> {
        const hydratedRow = { ...row };
        const schema = (this as any).schema;

        for (const key in row) {
            if (typeof row[key] === 'function') {
                hydratedRow[key] = await new Promise((resolve, reject) => {
                    row[key]((err: any, name: any, stream: any) => {
                        if (err) return reject(err);
                        let buffer = Buffer.from([]);
                        stream.on('data', (chunk: any) => { buffer = Buffer.concat([buffer, chunk]); });
                        stream.on('end', () => {
                            const isText = isTextType(schema[key]?.type);
                            resolve(isText ? buffer.toString('utf-8') : buffer);
                        });
                        stream.on('error', (sErr: any) => reject(sErr));
                    });
                });
            }
        }
        return hydratedRow;
    }

    // --- MÉTODOS ESTÁTICOS DE BUSCA ---

    public static async findAll<T extends Model>(
        this: new (v: any, options?: any) => T,
        options: QueryOptions = {}
    ): Promise<T[]> {
        const modelClass = this as any;
        const mergedOptions = modelClass.applyScopes(options);
        const { sql, params, includeMeta, separatePlans } = QueryBuilder.select(modelClass, mergedOptions);
        const results = await modelClass.connection.execute(
            sql,
            params,
            mergedOptions.transaction,
            { logging: mergedOptions.logging, benchmark: mergedOptions.benchmark }
        );

        const hydratedResults = await Promise.all(results.map((row: any) => modelClass.hydrate(row)));
        const materialized = modelClass.materializeIncludes(hydratedResults, includeMeta);
        if (separatePlans?.length) {
            await applySeparateFetches(materialized, separatePlans, mergedOptions);
        }
        return materialized.map((row: any) => {
            const instance = new this(row, { isNewRecord: false });
            instance._previousDataValues = { ...instance.dataValues };
            return instance;
        });
    }

    public static async findOne<T extends Model>(this: new (v: any) => T, options: QueryOptions = {}): Promise<T | null> {
        const results = await (this as any).findAll({ ...options, limit: 1 });
        return results.length > 0 ? results[0] : null;
    }

    /**
     * Nome(s) do(s) atributo(s) de chave primária (a partir de `schema` ou de `primaryKey` estático).
     */
    public static getPrimaryKeyAttributeNames(this: any): string[] {
        const schema = this.schema || {};
        const pks = Object.keys(schema).filter((k) => (schema as Record<string, ColumnOptions>)[k]?.primaryKey);
        if (pks.length) return pks;
        if (this.primaryKey) return [String(this.primaryKey)];
        return ['ID'];
    }

    private static whereForFindByPk(modelClass: any, identifier: any): Record<string, any> {
        const names = modelClass.getPrimaryKeyAttributeNames();
        if (names.length === 0) {
            throw new Error('findByPk: model has no primary key defined.');
        }
        if (names.length === 1) {
            const k = names[0]!;
            if (Array.isArray(identifier)) {
                if (identifier.length === 0) {
                    return {} as any;
                }
                return { [k]: identifier[0] } as Record<string, any>;
            }
            if (identifier !== null && typeof identifier === 'object' && !Array.isArray(identifier) && !Buffer.isBuffer(identifier) && !(identifier instanceof Date)) {
                if (Object.prototype.hasOwnProperty.call(identifier, k)) {
                    return { [k]: (identifier as any)[k] } as Record<string, any>;
                }
            }
            return { [k]: identifier } as Record<string, any>;
        }
        if (Array.isArray(identifier)) {
            if (identifier.length !== names.length) {
                throw new Error(
                    `findByPk: chave composta requer ${names.length} valor(es) no array, recebido: ${identifier.length}.`
                );
            }
            const w: Record<string, any> = {};
            names.forEach((n: string, i: number) => {
                w[n] = identifier[i];
            });
            return w;
        }
        if (identifier !== null && typeof identifier === 'object' && !Array.isArray(identifier) && !Buffer.isBuffer(identifier)) {
            const w: Record<string, any> = {};
            for (const n of names) {
                if (!Object.prototype.hasOwnProperty.call(identifier, n)) {
                    throw new Error(`findByPk: chave composta: falta o campo "${n}" no identificador.`);
                }
                w[n] = (identifier as any)[n];
            }
            return w;
        }
        throw new Error('findByPk: para chave composta use array de valores (na ordem da PK) ou um objeto com todos os campos.');
    }

    /**
     * Busca uma linha pela chave primária. `null`/`undefined` no identificador retorna `null` (estilo Sequelize).
     */
    public static async findByPk<T extends Model>(
        this: new (v: any) => T,
        identifier: any,
        options: QueryOptions = {}
    ): Promise<T | null> {
        if (identifier === null || identifier === undefined) {
            return null;
        }
        const modelClass = this as any;
        const wherePk = Model.whereForFindByPk(modelClass, identifier);
        if (Object.keys(wherePk).length === 0) {
            return null;
        }
        return (this as any).findOne({
            ...options,
            where: {
                ...options.where,
                ...wherePk
            }
        });
    }

    public static async count(options: QueryOptions = {}): Promise<number> {
        const modelClass = this as any;
        const mergedOptions = modelClass.applyScopes(options);
        const { sql, params } = QueryBuilder.count(modelClass, mergedOptions);
        const result = await modelClass.connection.execute(
            sql,
            params,
            mergedOptions.transaction,
            { logging: mergedOptions.logging, benchmark: mergedOptions.benchmark }
        );
        return result[0]?.TOTAL || 0;
    }

    /**
     * Compatível com Sequelize: retorna total + linhas da busca paginada.
     * - `count` ignora `limit`/`offset`/`order` para refletir o total completo do filtro.
     * - `rows` respeita as opções originais (incluindo paginação).
     */
    public static async findAndCountAll<T extends Model>(
        this: new (v: any, options?: any) => T,
        options: QueryOptions = {}
    ): Promise<{ count: number; rows: T[] }> {
        const countOptions: QueryOptions = { ...options };
        delete (countOptions as any).limit;
        delete (countOptions as any).offset;
        delete (countOptions as any).order;

        const [count, rows] = await Promise.all([
            (this as any).count(countOptions),
            (this as any).findAll(options)
        ]);

        return { count, rows };
    }

    public static async create<T extends Model>(
        this: new (v: any, options?: any) => T,
        values: Record<string, any>,
        options: SaveOptions = {}
    ): Promise<T> {
        const instance = new this(values, { isNewRecord: true });
        return instance.save(options);
    }

    public static async bulkCreate<T extends Model>(
        this: any,
        valuesList: Record<string, any>[],
        options: SaveOptions = {}
    ): Promise<T[]> {
        const results: T[] = [];
        for (const values of valuesList) {
            results.push(await this.create(values, options));
        }
        return results;
    }

    public static async update(
        this: new (v: any, options?: InstanceOptions) => any,
        values: Record<string, any>,
        options: QueryOptions = {}
    ): Promise<[number, any[]]> {
        const modelClass = this as any;
        const merged = modelClass.applyScopes(options) as QueryOptions;
        const data: Record<string, any> = { ...values };
        for (const k of Object.keys(data)) {
            if (data[k] === undefined) delete data[k];
        }
        if (modelClass.modelOptions?.timestamps) {
            const now = new Date();
            const sch = modelClass.schema || {};
            if (Object.prototype.hasOwnProperty.call(sch, 'updatedAt') && data.updatedAt === undefined) {
                data.updatedAt = now;
            } else {
                const k = Object.keys(sch).find(
                    (c) => c !== 'createdAt' && c !== 'CREATEDAT' && /updated|alterad/i.test(c)
                );
                if (k && data[k] === undefined) data[k] = now;
            }
        }
        if (Object.keys(data).length === 0) {
            return [0, []];
        }
        const where = merged.where || {};
        const { sql, params } = QueryBuilder.update(modelClass, data, where as Record<string, any>);
        const result = await modelClass.connection.execute(
            sql,
            params,
            merged.transaction,
            { logging: merged.logging, benchmark: merged.benchmark }
        );
        const rawRows = result || [];
        const instances: any[] = [];
        for (const row of rawRows) {
            const h = await modelClass.hydrate(row);
            const inst = new this(h, { isNewRecord: false });
            inst._previousDataValues = { ...inst.dataValues };
            instances.push(inst);
        }
        return [instances.length, instances];
    }

    public static async destroy(this: any, options: QueryOptions = {}): Promise<number> {
        const modelClass = this as any;
        const merged = modelClass.applyScopes(options) as QueryOptions;
        const where = (merged.where || {}) as Record<string, any>;
        const { sql, params } = QueryBuilder.delete(modelClass, where, { returning: true });
        const result = await modelClass.connection.execute(
            sql,
            params,
            merged.transaction,
            { logging: merged.logging, benchmark: merged.benchmark }
        );
        return (result || []).length;
    }

    // --- MÉTODOS DE INSTÂNCIA ---

    public changed(key?: string): boolean | string[] {
        const changedKeys = Object.keys(this.dataValues).filter((field) => {
            return this.dataValues[field] !== this._previousDataValues[field];
        });
        if (key) return changedKeys.includes(key);
        return changedKeys;
    }

    public previous(key?: string): any {
        if (!key) return { ...this._previousDataValues };
        return this._previousDataValues[key];
    }

    public get(key: string): any {
        return this.dataValues[key];
    }

    public set(key: string | Record<string, any>, value?: any): this {
        if (typeof key === 'string') {
            this.dataValues[key] = value;
            return this;
        }

        this.dataValues = { ...this.dataValues, ...key };
        return this;
    }

    public async validate(): Promise<void> {
        const modelClass = this.constructor as any;
        const schema = modelClass.schema || {};
        const errors: string[] = [];

        for (const [key, column] of Object.entries<ColumnOptions>(schema)) {
            const value = this.dataValues[key];
            const allowNull = column.allowNull ?? true;

            if ((value === null || value === undefined) && !allowNull) {
                errors.push(`${key} cannot be null.`);
                continue;
            }

            if (value === undefined && column.defaultValue !== undefined) {
                this.dataValues[key] = typeof column.defaultValue === 'function'
                    ? column.defaultValue()
                    : column.defaultValue;
            }

            const enumValues = this.resolveEnumValues(column.type);
            if (enumValues && value !== undefined && value !== null && !enumValues.includes(value)) {
                errors.push(`${key} must be one of: ${enumValues.join(', ')}`);
            }

            if (!column.validate) continue;

            if (typeof column.validate === 'function') {
                const result = await column.validate(value);
                if (result === false) errors.push(`${key} failed validation.`);
                if (typeof result === 'string') errors.push(result);
                continue;
            }

            for (const [validatorName, spec] of Object.entries(column.validate as Record<string, any>)) {
                const result = await runValidateEntry(key, validatorName, spec, value, column);
                if (result === false) {
                    errors.push(`${key} failed "${validatorName}" validation.`);
                } else if (typeof result === 'string' && result) {
                    errors.push(result);
                }
            }
        }

        if (errors.length > 0) {
            throw new ValidationError('Validation error', errors);
        }
    }

    public async save(options: SaveOptions = {}): Promise<this> {
        const modelClass = this.constructor as any;
        const tx = options.transaction;
        const pkField = modelClass.primaryKey;
        const pkValue = this.dataValues[pkField];
        const changedFields = this.changed() as string[];

        if (modelClass.modelOptions?.timestamps) {
            const now = new Date();
            if (this.isNewRecord && this.dataValues.createdAt === undefined) this.dataValues.createdAt = now;
            this.dataValues.updatedAt = now;
        }

        let result;
        await modelClass.runHooks('beforeSave', this, options);
        if (this.isNewRecord) await modelClass.runHooks('beforeCreate', this, options);
        else await modelClass.runHooks('beforeUpdate', this, options);
        await this.validate();

        if (!this.isNewRecord && pkValue !== undefined && pkValue !== null) {
            // UPDATE
            const updateData = changedFields
                .filter((field) => field !== pkField)
                .reduce((acc: Record<string, any>, field) => {
                    acc[field] = this.dataValues[field];
                    return acc;
                }, {});

            if (Object.keys(updateData).length === 0) return this;
            const { sql, params } = QueryBuilder.update(modelClass, updateData, { [pkField]: pkValue });
            result = await modelClass.connection.execute(
                sql,
                params,
                tx,
                { logging: options.logging, benchmark: options.benchmark }
            );

            if (result && result.length > 0) {
                const hydrated = await modelClass.hydrate(result[0]);
                this.dataValues = { ...this.dataValues, ...hydrated };
            }
        } else {
            // INSERT
            const insertData = { ...this.dataValues };

            for (const key in modelClass.schema) {
                const config = modelClass.schema[key];

                if (config.autoIncrement && (insertData[key] === undefined || insertData[key] === null)) {
                    if (config.sequence) {
                        const seqSql = `SELECT NEXT VALUE FOR ${config.sequence.toUpperCase()} FROM RDB$DATABASE`;
                        const seqRes = await modelClass.connection.execute(
                            seqSql,
                            [],
                            tx,
                            { logging: options.logging, benchmark: options.benchmark }
                        );
                        insertData[key] = seqRes[0].NEXT_VALUE || Object.values(seqRes[0])[0];
                    } else {
                        // Fallback: MAX + 1
                        const maxSql = `SELECT MAX(${key.toUpperCase()}) AS MAX_ID FROM ${modelClass.tableName.toUpperCase()}`;
                        const maxRes = await modelClass.connection.execute(
                            maxSql,
                            [],
                            tx,
                            { logging: options.logging, benchmark: options.benchmark }
                        );
                        const maxRow = maxRes[0] as Record<string, unknown> | undefined;
                        const currentMax = maxRow
                            ? (maxRow.MAX_ID ?? maxRow.max_id ?? Object.values(maxRow)[0] ?? 0)
                            : 0;
                        // Garantimos que o ID seja tratado como Number para evitar problemas com BIGINT
                        insertData[key] = Number(currentMax) + 1;
                    }
                }
            }

            const { sql, params } = QueryBuilder.insert(modelClass, insertData);
            result = await modelClass.connection.execute(
                sql,
                params,
                tx,
                { logging: options.logging, benchmark: options.benchmark }
            );

            const dbData = (result && result.length > 0) ? await modelClass.hydrate(result[0]) : {};

            this.dataValues = { ...insertData, ...dbData };
        }

        if (this.isNewRecord) await modelClass.runHooks('afterCreate', this, options);
        else await modelClass.runHooks('afterUpdate', this, options);
        await modelClass.runHooks('afterSave', this, options);

        this.isNewRecord = false;
        this._previousDataValues = { ...this.dataValues };
        return this;
    }

    public async destroy(options: SaveOptions = {}): Promise<void> {
        const modelClass = this.constructor as any;
        const tx = options.transaction;
        const pkField = modelClass.primaryKey;
        const pkValue = this.dataValues[pkField];

        if (pkValue === undefined || pkValue === null) throw new Error("Não é possível deletar: Chave primária ausente.");

        await modelClass.runHooks('beforeDestroy', this, options);

        const { sql, params } = QueryBuilder.delete(modelClass, { [pkField]: pkValue });
        await modelClass.connection.execute(
            sql,
            params,
            tx,
            { logging: options.logging, benchmark: options.benchmark }
        );
        this.dataValues = {};
        this.isNewRecord = true;
        this._previousDataValues = {};
        await modelClass.runHooks('afterDestroy', this, options);
    }

    public async delete(options: SaveOptions = {}): Promise<void> {
        return this.destroy(options);
    }

    /**
     * Recarrega a linha do banco (por PK), aplicando o mesmo estilo de opções de `findOne` (include, attributes, transação, etc.).
     */
    public async reload(options: QueryOptions = {}): Promise<this> {
        const modelClass = this.constructor as any;
        if (this.isNewRecord) {
            throw new Error('Não é possível dar reload em instância ainda não persistida (isNewRecord).');
        }
        const names = modelClass.getPrimaryKeyAttributeNames() as string[];
        const wherePk: Record<string, any> = {};
        for (const n of names) {
            const v = this.dataValues[n];
            if (v === undefined || v === null) {
                throw new Error(`Não é possível dar reload: chave primária "${n}" nula ou indefinida.`);
            }
            wherePk[n] = v;
        }
        const reloaded = await modelClass.findOne({
            ...options,
            where: {
                ...options.where,
                ...wherePk
            }
        });
        if (!reloaded) {
            throw new Error('Reload: o registro não foi encontrado (pode ter sido excluído).');
        }
        this.dataValues = { ...reloaded.dataValues };
        this._previousDataValues = { ...reloaded._previousDataValues };
        this.isNewRecord = false;
        return this;
    }

    protected resolveEnumValues(type: DataTypeInput): Array<string | number> | undefined {
        if (typeof type === 'string') return undefined;
        const def = type as DataTypeDefinition;
        return def.key === 'ENUM' ? def.values : undefined;
    }

    protected static applyScopes(options: QueryOptions): QueryOptions {
        if (options.ignoreDefaultScope) return options;
        const modelClass = this as any;
        const defaultScope = modelClass.defaultScope || {};
        return {
            ...defaultScope,
            ...options,
            where: {
                ...(defaultScope.where || {}),
                ...(options.where || {})
            }
        };
    }

    protected static async runHooks(name: HookName, instance: Model, options: any): Promise<void> {
        const modelClass = this as any;
        const globalHooks = (modelClass.globalHooks?.[name] || []) as HookHandler[];
        const localHooks = (modelClass.hooks?.[name] || []) as HookHandler[];
        for (const hook of [...globalHooks, ...localHooks]) {
            await hook(instance, options);
        }
    }

    protected static materializeIncludes(rows: any[], includeMeta: IncludeProjectionMeta[] = []): any[] {
        if (!includeMeta.length) return rows;
        const modelClass = this as any;
        const primaryKey = modelClass.primaryKey || 'ID';
        const grouped = new Map<any, any>();
        const orderedMeta = [...includeMeta].sort((a, b) => a.path.length - b.path.length);

        for (const row of rows) {
            const parentKey = row[primaryKey];
            const parent = grouped.get(parentKey) || { ...row };

            for (const meta of orderedMeta) {
                const related: Record<string, any> = {};
                const prefix = `${meta.sqlAlias}__`;
                for (const [column, value] of Object.entries(row)) {
                    if (!column.startsWith(prefix)) continue;
                    const attrName = column.replace(prefix, '');
                    related[attrName] = value;
                    delete parent[column];
                }

                const hasValues = Object.values(related).some((value) => value !== null && value !== undefined);
                this.assignIncludeValue(parent, meta.path, meta.type, related, hasValues, meta.dedupeBy);
            }

            grouped.set(parentKey, parent);
        }

        return Array.from(grouped.values());
    }

    private static assignIncludeValue(
        parent: Record<string, any>,
        path: string[],
        type: 'single' | 'many',
        related: Record<string, any>,
        hasValues: boolean,
        dedupeBy?: string
    ): void {
        if (path.length === 0) return;

        let cursor: any = parent;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (Array.isArray(cursor[key])) {
                if (!cursor[key].length) cursor[key].push({});
                cursor = cursor[key][cursor[key].length - 1];
                continue;
            }

            if (!cursor[key] || typeof cursor[key] !== 'object') {
                cursor[key] = {};
            }
            cursor = cursor[key];
        }

        const finalKey = path[path.length - 1];
        if (type === 'many') {
            if (!Array.isArray(cursor[finalKey])) cursor[finalKey] = [];
            if (!hasValues) return;
            if (dedupeBy) {
                const raw = related[dedupeBy];
                if (raw === null || raw === undefined) return;
                const k = String(raw);
                const arr = cursor[finalKey] as any[];
                if (arr.some((row) => row != null && String((row as any)[dedupeBy]) === k)) return;
            }
            cursor[finalKey].push(related);
            return;
        }

        cursor[finalKey] = hasValues ? related : null;
    }
}

export type HookName =
    | 'beforeCreate'
    | 'afterCreate'
    | 'beforeUpdate'
    | 'afterUpdate'
    | 'beforeSave'
    | 'afterSave'
    | 'beforeDestroy'
    | 'afterDestroy';

export type HookHandler = (instance: Model, options?: any) => Promise<void> | void;

export type SaveOptions = {
    transaction?: Firebird.Transaction;
    logging?: boolean | ((sql: string, timingMs?: number) => void);
    benchmark?: boolean;
};

type InstanceOptions = {
    isNewRecord?: boolean;
};

/** Instância de `OriusORM` (ou stub); evita `import type` circular com `index.ts`. */
export type OrmForModelInit = {
    getConnection(): unknown;
    registerModel(model: typeof Model): void;
};

export type ModelInitOptions = {
    tableName?: string;
    primaryKey?: string;
    defaultScope?: QueryOptions;
    scopes?: ScopeMap;
    timestamps?: boolean;
    /** Em vez de `Model.init(attrs, { sequelize })` — registra o model em `orm.models` e aplica a conexão. */
    orm?: OrmForModelInit;
};

class ScopedModel {
    constructor(private readonly modelClass: any, private readonly scopeOptions: QueryOptions) {}

    private merge(options: QueryOptions = {}): QueryOptions {
        return {
            ...this.scopeOptions,
            ...options,
            where: {
                ...(this.scopeOptions.where || {}),
                ...(options.where || {})
            }
        };
    }

    public findAll(options: QueryOptions = {}) {
        return this.modelClass.findAll(this.merge(options));
    }

    public findOne(options: QueryOptions = {}) {
        return this.modelClass.findOne(this.merge(options));
    }

    public findByPk(identifier: any, options: QueryOptions = {}) {
        return this.modelClass.findByPk(identifier, this.merge(options));
    }

    public count(options: QueryOptions = {}) {
        return this.modelClass.count(this.merge(options));
    }

    public findAndCountAll(options: QueryOptions = {}) {
        return this.modelClass.findAndCountAll(this.merge(options));
    }

    public update(values: Record<string, any>, options: QueryOptions = {}) {
        return this.modelClass.update(values, this.merge(options));
    }

    public destroy(options: QueryOptions = {}) {
        return this.modelClass.destroy(this.merge(options));
    }
}