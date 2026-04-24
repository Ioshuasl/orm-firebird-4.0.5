import * as Firebird from 'node-firebird';
import { ConnectionAcquireTimeoutError, mapDatabaseError } from './errors';
import { sanitizeIdentifier } from './sql-utils';

export interface ConnectionConfig extends Firebird.Options {
    maxPool?: number;
    logging?: boolean | ((sql: string, timingMs?: number) => void);
    benchmark?: boolean;
}

export class Connection {
    private pool: Firebird.ConnectionPool;
    private readonly config: Firebird.Options;
    private readonly logging: boolean | ((sql: string, timingMs?: number) => void);
    private readonly benchmark: boolean;
    private savepointSerial = 0;

    constructor(config: ConnectionConfig, maxPool: number = 10) {
        const normalized = Connection.normalizeConfig(config);
        const poolSize = config.maxPool ?? maxPool;

        this.config = normalized;
        this.logging = config.logging ?? false;
        this.benchmark = config.benchmark ?? false;
        this.pool = Firebird.pool(poolSize, normalized);
        console.log(`🔥 ORM: Conexão com Firebird inicializada (${normalized.host}:${normalized.port}/${normalized.database}).`);
    }

    public static normalizeConfig(config: ConnectionConfig): Firebird.Options {
        const normalized: Firebird.Options = {
            host: config.host || '127.0.0.1',
            port: Number(config.port || 3050),
            database: (config.database || '').trim(),
            user: config.user || 'SYSDBA',
            password: config.password || 'masterkey',
            lowercase_keys: config.lowercase_keys ?? false,
            pageSize: config.pageSize || 4096,
            encoding: config.encoding || 'UTF8',
            role: config.role
        };

        // Suporte a formatos comuns de string:
        // - host/port:database
        // - host:database
        // - alias puro (database alias)
        if (normalized.database && normalized.database.includes(':') && normalized.database.includes('/')) {
            const [hostPortPart, dbPart] = normalized.database.split(':');
            const [hostPart, portPart] = hostPortPart.split('/');
            if (hostPart) normalized.host = hostPart;
            if (portPart) normalized.port = Number(portPart);
            normalized.database = dbPart;
        }

        if (!normalized.database) {
            throw new Error('Configuração inválida: informe "database" com alias ou caminho remoto.');
        }

        return normalized;
    }

    public getConfig(): Firebird.Options {
        return this.config;
    }

    public async authenticate(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.acquireConnection().then((db) => {
                db.query('SELECT 1 AS OK FROM RDB$DATABASE', [], (queryErr) => {
                    db.detach();
                    if (queryErr) return reject(mapDatabaseError(queryErr));
                    resolve();
                });
            }).catch((err) => reject(err));
        });
    }

    public close(): void {
        const destroy = (this.pool as any).destroy;
        if (typeof destroy === 'function') {
            destroy.call(this.pool);
        }
    }

    public async execute<T>(
        sql: string,
        params: any[] = [],
        transaction?: Firebird.Transaction,
        options: { logging?: boolean | ((sql: string, timingMs?: number) => void); benchmark?: boolean } = {}
    ): Promise<T[]> {
        const logMode = options.logging ?? this.logging;
        const benchmark = options.benchmark ?? this.benchmark;
        const startTime = benchmark ? Date.now() : 0;

        const logQuery = () => {
            if (!logMode) return;
            const timing = benchmark ? Date.now() - startTime : undefined;
            if (typeof logMode === 'function') {
                logMode(sql, timing);
            } else {
                console.log(benchmark ? `[SQL ${timing}ms] ${sql}` : `[SQL] ${sql}`);
            }
        };

        // Quando existe transaction, usamos ela para garantir consistência/isolamento.
        if (transaction) {
            return new Promise((resolve, reject) => {
                transaction.execute(sql, params, (queryErr, result) => {
                    if (queryErr) return reject(mapDatabaseError(queryErr));
                    logQuery();
                    resolve(result as T[]);
                });
            });
        }

        return new Promise((resolve, reject) => {
            this.acquireConnection().then((db) => {
                db.query(sql, params, (queryErr, result) => {
                    db.detach(); // Devolve ao pool
                    if (queryErr) return reject(mapDatabaseError(queryErr));
                    logQuery();
                    resolve(result as T[]);
                });
            }).catch((err) => reject(err));
        });
    }

    /**
     * API estilo "sequelize.transaction(async (tx) => {...})".
     * - Cria uma transação
     * - Executa o callback
     * - Commit se der tudo certo; rollback se falhar
     */
    public async transaction<T>(
        fn: (tx: Firebird.Transaction) => Promise<T>,
        options?: Firebird.TransactionOptions | Firebird.Isolation
    ): Promise<T>;
    /**
     * “Transação aninhada” (padrão Sequelize): envolve o callback num **SAVEPOINT** da transação
     * já aberta. Em falha, faz `ROLLBACK TO SAVEPOINT` (a transação exterior mantém-se).
     */
    public async transaction<T>(
        options: { transaction: Firebird.Transaction; savepointName?: string },
        fn: (tx: Firebird.Transaction) => Promise<T>
    ): Promise<T>;
    public async transaction<T>(
        first: ((tx: Firebird.Transaction) => Promise<T>) | { transaction: Firebird.Transaction; savepointName?: string },
        second?: Firebird.TransactionOptions | Firebird.Isolation | ((tx: Firebird.Transaction) => Promise<T>)
    ): Promise<T> {
        if (typeof first === 'function') {
            return this.startTransaction(first, second as Firebird.TransactionOptions | Firebird.Isolation);
        }
        if (first && typeof first === 'object' && 'transaction' in first) {
            const parent = (first as { transaction: Firebird.Transaction; savepointName?: string }).transaction;
            const fn = second as (tx: Firebird.Transaction) => Promise<T>;
            if (typeof fn !== 'function') {
                throw new Error('transaction: segundo argumento deve ser a função (tx) => ...');
            }
            return this.withSavepoint(parent, () => fn(parent), {
                name: (first as { savepointName?: string }).savepointName
            });
        }
        throw new Error('Invalid transaction() arguments');
    }

    private async startTransaction<T>(
        fn: (tx: Firebird.Transaction) => Promise<T>,
        options: Firebird.TransactionOptions | Firebird.Isolation = Firebird.ISOLATION_READ_COMMITTED
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            this.acquireConnection().then((db) => {
                db.transaction(options, (txErr, tx) => {
                    if (txErr) {
                        db.detach();
                        return reject(mapDatabaseError(txErr));
                    }

                    const commit = () =>
                        new Promise<void>((cResolve, cReject) => {
                            tx.commit((commitErr) => {
                                if (commitErr) return cReject(mapDatabaseError(commitErr));
                                cResolve();
                            });
                        });

                    const rollback = () =>
                        new Promise<void>((rResolve, rReject) => {
                            tx.rollback((rollbackErr) => {
                                if (rollbackErr) return rReject(mapDatabaseError(rollbackErr));
                                rResolve();
                            });
                        });

                    (async () => {
                        try {
                            const result = await fn(tx);
                            await commit();
                            db.detach();
                            resolve(result);
                        } catch (fnErr) {
                            try {
                                await rollback();
                            } catch (rollbackErr) {
                                db.detach();
                                return reject(mapDatabaseError(rollbackErr));
                            }
                            db.detach();
                            reject(mapDatabaseError(fnErr));
                        }
                    })();
                });
            }).catch((err) => reject(err));
        });
    }

    private acquireConnection(maxAttempts: number = 2): Promise<Firebird.Database> {
        return new Promise((resolve, reject) => {
            const attemptAcquire = (attempt: number) => {
                this.pool.get((err, db) => {
                    if (err) return reject(mapDatabaseError(err));
                    this.validateConnection(db)
                        .then((isValid) => {
                            if (isValid) {
                                resolve(db);
                                return;
                            }

                            db.detach();
                            if (attempt >= maxAttempts) {
                                reject(new ConnectionAcquireTimeoutError('Acquire timeout: failed to acquire a valid pooled connection.'));
                                return;
                            }
                            attemptAcquire(attempt + 1);
                        })
                        .catch((validationErr) => {
                            db.detach();
                            if (attempt >= maxAttempts) {
                                reject(mapDatabaseError(validationErr));
                                return;
                            }
                            attemptAcquire(attempt + 1);
                        });
                });
            };

            attemptAcquire(1);
        });
    }

    private validateConnection(db: Firebird.Database): Promise<boolean> {
        return new Promise((resolve) => {
            db.query('SELECT 1 AS OK FROM RDB$DATABASE', [], (queryErr) => {
                resolve(!queryErr);
            });
        });
    }

    /**
     * Firebird: `SAVEPOINT` + `ROLLBACK TO SAVEPOINT` em falha. Use o mesmo `transaction` em
     * `execute(..., { transaction })` / modelos. Não cria transação nova.
     */
    public async withSavepoint<T>(
        transaction: Firebird.Transaction,
        fn: () => Promise<T>,
        options: { name?: string } = {}
    ): Promise<T> {
        const spName = options.name
            ? sanitizeIdentifier(options.name, 'save point')
            : `SPO${++this.savepointSerial}`;
        await this.execute(`SAVEPOINT ${spName}`, [], transaction, { logging: false, benchmark: false });
        try {
            return await fn();
        } catch (err) {
            try {
                await this.execute(`ROLLBACK TO SAVEPOINT ${spName}`, [], transaction, { logging: false, benchmark: false });
            } catch (rollbackToErr) {
                throw mapDatabaseError(rollbackToErr);
            }
            throw mapDatabaseError(err);
        }
    }
}