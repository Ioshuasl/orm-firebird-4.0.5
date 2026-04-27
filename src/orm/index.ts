import { Connection, ConnectionConfig } from './connection';
import { HookHandler, HookName, Model, ModelInitOptions } from './model';
import * as Firebird from 'node-firebird';
import { ColumnOptions } from './data-types';
import { syncOriusORM } from './schema/sync';
import { QueryInterface } from './schema/query-interface';
import type { SyncOptions, SyncResult } from './schema/types';
import { wireReferenceAssociations } from './auto-associations';

export interface OriusORMConfig extends ConnectionConfig {
    url?: string;
    uri?: string;
    dsn?: string;
    connectionString?: string; // ex.: "192.168.1.100/3050:mararosa"
    databaseAlias?: string;    // alias no databases.conf
}

export class OriusORM {
    private connection: Connection;
    public readonly models: Record<string, typeof Model> = {};
    /**
     * Se true (padrão), após cada `Model.init`/`define` com `{ orm }` percorre `references`
     * do schema e regista `belongsTo` + `hasMany` inverso. Idempotente. Desative se definir
     * todas as associações à mão.
     */
    public autoWireReferenceAssociations = true;

    constructor(config: OriusORMConfig | string) {
        const normalized = OriusORM.normalizeConfig(config);
        this.connection = new Connection(normalized, normalized.maxPool);
    }

    public static from(connection: OriusORMConfig | string): OriusORM {
        return new OriusORM(connection);
    }

    public static fromEnv(env: NodeJS.ProcessEnv = process.env): OriusORM {
        const config = OriusORM.configFromEnv(env);
        return new OriusORM(config);
    }

    public static configFromEnv(env: NodeJS.ProcessEnv = process.env): OriusORMConfig | string {
        const explicitUrl =
            env.FDB_URL ||
            env.FIREBIRD_URL ||
            env.DATABASE_URL ||
            env.FDB_URI ||
            env.FDB_DSN ||
            env.FDB_CONNECTION_STRING;

        if (explicitUrl && explicitUrl.trim()) {
            return {
                connectionString: explicitUrl.trim(),
                user: env.FDB_USER || env.FIREBIRD_USER || 'SYSDBA',
                password: env.FDB_PASSWORD || env.FIREBIRD_PASSWORD || 'masterkey',
                encoding: (env.FDB_ENCODING || env.FIREBIRD_ENCODING || 'UTF8') as any,
                role: env.FDB_ROLE || env.FIREBIRD_ROLE,
                pluginName: env.FDB_PLUGIN_NAME || env.FIREBIRD_PLUGIN_NAME,
                wireCrypt: env.FDB_WIRE_CRYPT ? Number(env.FDB_WIRE_CRYPT) : undefined,
                wireCompression: env.FDB_WIRE_COMPRESSION === 'true',
                maxPool: Number(env.FDB_POOL_SIZE || env.FIREBIRD_POOL_SIZE || 10),
                logging: env.ORM_LOG_SQL === 'true',
                benchmark: env.ORM_BENCHMARK_SQL === 'true'
            };
        }

        const database = env.FDB_DATABASE || env.FDB_ALIAS || env.FIREBIRD_DATABASE || '';
        return {
            host: env.FDB_HOST || env.FIREBIRD_HOST || '127.0.0.1',
            port: Number(env.FDB_PORT || env.FIREBIRD_PORT || 3050),
            databaseAlias: database || undefined,
            user: env.FDB_USER || env.FIREBIRD_USER || 'SYSDBA',
            password: env.FDB_PASSWORD || env.FIREBIRD_PASSWORD || 'masterkey',
            encoding: (env.FDB_ENCODING || env.FIREBIRD_ENCODING || 'UTF8') as any,
            role: env.FDB_ROLE || env.FIREBIRD_ROLE,
            pluginName: env.FDB_PLUGIN_NAME || env.FIREBIRD_PLUGIN_NAME,
            wireCrypt: env.FDB_WIRE_CRYPT ? Number(env.FDB_WIRE_CRYPT) : undefined,
            wireCompression: env.FDB_WIRE_COMPRESSION === 'true',
            maxPool: Number(env.FDB_POOL_SIZE || env.FIREBIRD_POOL_SIZE || 10),
            logging: env.ORM_LOG_SQL === 'true',
            benchmark: env.ORM_BENCHMARK_SQL === 'true'
        };
    }

    private static normalizeConfig(config: OriusORMConfig | string): ConnectionConfig {
        if (typeof config === 'string') {
            return this.normalizeConfig({ connectionString: config });
        }

        const merged: ConnectionConfig = {
            ...config,
            database: config.databaseAlias || config.database || ''
        };

        const rawConnection = config.url || config.uri || config.dsn || config.connectionString;
        if (rawConnection) {
            const raw = rawConnection.trim();
            const parsedUrl = this.tryParseUrl(raw);
            if (parsedUrl) {
                merged.host = parsedUrl.host || merged.host;
                merged.port = parsedUrl.port || merged.port;
                merged.database = parsedUrl.database || merged.database;
                merged.user = parsedUrl.user || merged.user;
                merged.password = parsedUrl.password || merged.password;
                merged.role = parsedUrl.role || merged.role;
                merged.encoding = (parsedUrl.encoding || merged.encoding) as any;
                merged.lowercase_keys = parsedUrl.lowercaseKeys ?? merged.lowercase_keys;
                merged.pageSize = parsedUrl.pageSize || merged.pageSize;
                merged.maxPool = parsedUrl.maxPool || merged.maxPool;
                merged.pluginName = parsedUrl.pluginName || merged.pluginName;
                merged.wireCrypt = parsedUrl.wireCrypt ?? merged.wireCrypt;
                merged.wireCompression = parsedUrl.wireCompression ?? merged.wireCompression;
                return merged;
            }

            // formato DSN clássico Firebird: host/port:db | host:db | alias
            const match = raw.match(/^([^/:]+)(?:\/(\d+))?:(.+)$/);
            if (match) {
                const [, host, port, database] = match;
                merged.host = host;
                if (port) merged.port = Number(port);
                merged.database = database;
            } else {
                // fallback: se não casar formato host/port:db, assume que veio só alias/caminho.
                merged.database = raw;
            }
        }

        return merged;
    }

    private static tryParseUrl(raw: string): ParsedConnectionUrl | null {
        const looksLikeUrl = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw);
        if (!looksLikeUrl) return null;

        const parsed = new URL(raw);
        const protocol = parsed.protocol.replace(':', '').toLowerCase();
        const isFirebirdScheme = ['firebird', 'fb', 'jdbc:firebirdsql', 'firebirdsql'].includes(protocol);
        if (!isFirebirdScheme) return null;

        const query = parsed.searchParams;
        const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));

        return {
            host: parsed.hostname || undefined,
            port: parsed.port ? Number(parsed.port) : undefined,
            database: database || undefined,
            user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
            password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
            encoding: query.get('encoding') || undefined,
            role: query.get('role') || undefined,
            lowercaseKeys: query.has('lowercase_keys')
                ? query.get('lowercase_keys') === 'true'
                : undefined,
            pageSize: query.get('pageSize') ? Number(query.get('pageSize')) : undefined,
            maxPool: query.get('maxPool') ? Number(query.get('maxPool')) : undefined
            ,
            pluginName: query.get('pluginName') || undefined,
            wireCrypt: query.get('wireCrypt') ? Number(query.get('wireCrypt')) : undefined,
            wireCompression: query.get('wireCompression')
                ? query.get('wireCompression') === 'true'
                : undefined
        };
    }

    public async authenticate(): Promise<void> {
        return this.connection.authenticate();
    }

    public close(): void {
        this.connection.close();
    }

    public getConnection(): Connection {
        return this.connection;
    }

    public define(modelClass: typeof Model, tableName: string): typeof Model;
    public define(
        modelName: string,
        attributes: Record<string, ColumnOptions>,
        options?: DefineModelOptions
    ): typeof Model;
    public define(
        modelClassOrName: typeof Model | string,
        tableOrAttributes: string | Record<string, ColumnOptions>,
        options: DefineModelOptions = {}
    ): typeof Model {
        // Compatibilidade com assinatura legada: define(ModelClass, tableName)
        if (typeof modelClassOrName !== 'string') {
            const modelClass = modelClassOrName;
            const tableName = tableOrAttributes as string;
            (modelClass as any).tableName = tableName;
            (modelClass as any).setConnection(this.connection);
            this.registerModel(modelClass);
            return modelClass;
        }

        // Assinatura Sequelize-like: define('ModelName', attributes, options)
        const modelName = modelClassOrName;
        const attributes = tableOrAttributes as Record<string, ColumnOptions>;
        const tableName = options.tableName || modelName.toUpperCase();

        class DynamicModel extends Model {}

        Object.defineProperty(DynamicModel, 'name', {
            value: modelName,
            configurable: true
        });

        (DynamicModel as any).modelName = modelName;
        const { orm: _ormIgnored, ...defineOptions } = options;
        DynamicModel.init(attributes, {
            ...defineOptions,
            tableName,
            orm: this
        });
        return DynamicModel;
    }

    public init<T extends typeof Model>(
        modelClass: T,
        attributes: Record<string, ColumnOptions>,
        options: DefineModelOptions = {}
    ): T {
        const modelName = options.modelName || (modelClass as any).modelName || modelClass.name;
        const tableName = options.tableName || (modelClass as any).tableName || modelName.toUpperCase();

        (modelClass as any).modelName = modelName;
        const { orm: _ormIgnored, ...ormInitOptions } = options;
        modelClass.init(attributes, {
            ...ormInitOptions,
            tableName,
            orm: this
        });
        return modelClass;
    }

    public model(modelName: string): typeof Model {
        const resolved = this.models[modelName];
        if (!resolved) {
            throw new Error(`Model "${modelName}" is not registered.`);
        }
        return resolved;
    }

    public addHook(name: HookName, handler: HookHandler): void {
        Model.addGlobalHook(name, handler);
    }

    public registerModel(modelClass: typeof Model): void {
        const name = (modelClass as any).modelName || modelClass.name;
        const tableName = (modelClass as any).tableName;
        if (name) this.models[name] = modelClass;
        if (tableName) this.models[tableName] = modelClass;
        if (this.autoWireReferenceAssociations) {
            wireReferenceAssociations(this);
        }
    }

    /**
     * Reaplica o auto‑wire a partir de `references` (útil se registar models depois de desligar
     * o automático, ou se alterar o schema em runtime).
     */
    public associateFromReferences(): void {
        wireReferenceAssociations(this);
    }

    /**
     * Cria transação e expõe o objeto tx para que você passe em { transaction }.
     * Ex:
     * await orm.transaction(async (tx) => {
     *   await Ato.create(..., { transaction: tx })
     * });
     */
    public async transaction<T>(
        fn: (tx: Firebird.Transaction) => Promise<T>,
        options?: Firebird.TransactionOptions | Firebird.Isolation
    ): Promise<T>;
    public async transaction<T>(
        options: { transaction: Firebird.Transaction; savepointName?: string },
        fn: (tx: Firebird.Transaction) => Promise<T>
    ): Promise<T>;
    public async transaction<T>(
        first: ((tx: Firebird.Transaction) => Promise<T>) | { transaction: Firebird.Transaction; savepointName?: string },
        second?: Firebird.TransactionOptions | Firebird.Isolation | ((tx: Firebird.Transaction) => Promise<T>)
    ): Promise<T> {
        return (this.connection as any).transaction(first, second);
    }

    /**
     * Savepoint a partir de uma transação já aberta (não cria conexão nova). Ver `Connection.withSavepoint`.
     */
    public withSavepoint<T>(
        parent: Firebird.Transaction,
        fn: () => Promise<T>,
        options: { name?: string } = {}
    ): Promise<T> {
        return this.connection.withSavepoint(parent, fn, options);
    }
}

type ParsedConnectionUrl = {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    encoding?: string;
    role?: string;
    lowercaseKeys?: boolean;
    pageSize?: number;
    maxPool?: number;
    pluginName?: string;
    wireCrypt?: number;
    wireCompression?: boolean;
};

export type DefineModelOptions = ModelInitOptions & {
    modelName?: string;
};

export { materializeNodeFirebirdBlob, materializeBlobsInRows } from './blob-utils';
export { Connection } from './connection';
export { DataType } from './data-types';
export { DataTypes } from './data-types';
export { Model } from './model';
export type { OrmForModelInit } from './model';
export { Op } from './operators';
export {
    BUILTIN_VALIDATOR_NAMES,
    isBuiltInValidatorKey,
    buildBuiltinValidator,
    runValidateEntry
} from './validators';
export {
    getAssociations,
    registerAssociation,
    registerBelongsToMany,
    findAssociation
} from './associations';
export type {
    AssociationType,
    AssociationOptions,
    BelongsToManyOptions,
    AssociationDefinition,
    ModelStaticLike
} from './associations';
export { wireReferenceAssociations, resolveReferencedModel } from './auto-associations';
export type { OrmWithModels } from './auto-associations';
export * from './errors';
export { syncOriusORM, syncModelWithOrm, topologicalSortForSync } from './schema/sync';
export { QueryInterface } from './schema/query-interface';
export type { TruncateTableOptions, RenameTableOptions, RemoveIndexOptions } from './schema/query-interface';
export type {
    SyncOptions,
    SyncResult,
    FirebirdForeignKeyInfo,
    ForeignKeyModelSpec,
    FirebirdColumnDescription,
    FirebirdConstraintInfo,
    FirebirdIndexInfo
} from './schema/types';
export type { OriusORMForSync } from './schema/sync';