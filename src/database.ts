import * as Firebird from 'node-firebird';
import * as dotenv from 'dotenv';

dotenv.config();

export class FirebirdDB {
    private static pool: Firebird.ConnectionPool;

    private static parseConnectionString(connectionString: string): {
        host: string;
        port: number;
        database: string;
    } {
        const raw = connectionString.trim();
        const match = raw.match(/^([^/:]+)(?:\/(\d+))?:(.+)$/);
        if (!match) {
            throw new Error(
                `FDB_CONNECTION_STRING inválida: "${connectionString}". Use o formato host/porta:database`
            );
        }

        const [, host, port, database] = match;
        return {
            host,
            port: Number(port || 3050),
            database: database.trim()
        };
    }

    private static buildConfig(): Firebird.Options {
        const mode = (process.env.ORM_CONNECTION_MODE || '').toLowerCase();
        const connectionString = process.env.FDB_CONNECTION_STRING;
        const useNetwork = mode === 'network' || !!connectionString;

        let host = process.env.FDB_HOST || '127.0.0.1';
        let port = parseInt(process.env.FDB_PORT || '3050');
        let database = (process.env.FDB_DATABASE || '').trim();

        if (useNetwork) {
            if (!connectionString) {
                throw new Error('Modo network ativo, mas FDB_CONNECTION_STRING não foi definida.');
            }
            const parsed = this.parseConnectionString(connectionString);
            host = parsed.host;
            port = parsed.port;
            database = parsed.database;
        }

        if (!database) {
            throw new Error(
                'Configuração inválida: informe FDB_DATABASE (local) ou FDB_CONNECTION_STRING (rede).'
            );
        }

        return {
            host,
            port,
            database,
            user: process.env.FDB_USER || 'SYSDBA',
            password: process.env.FDB_PASSWORD || 'masterkey',
            encoding: (process.env.FDB_ENCODING as any) || 'UTF8',
            lowercase_keys: false,
            pageSize: 4096
        };
    }

    public static getPool(): Firebird.ConnectionPool {
        if (!this.pool) {
            const config = this.buildConfig();
            // Configurado de acordo com seu firebird.conf (ExtConnPoolSize)
            const max = parseInt(process.env.FDB_POOL_SIZE || '10');
            this.pool = Firebird.pool(max, config);
            console.log(`🔥 Pool Firebird 4.0 inicializado (${config.host}:${config.port}/${config.database}).`);
        }
        return this.pool;
    }

    public static async query<T>(sql: string, params: any[] = []): Promise<T[]> {
        return new Promise((resolve, reject) => {
            this.getPool().get((err, db) => {
                if (err) {
                    console.error('❌ Erro ao obter conexão do pool:', err);
                    return reject(err);
                }

                db.query(sql, params, (queryErr, result) => {
                    db.detach(); // Devolve a conexão ao pool imediatamente
                    if (queryErr) return reject(queryErr);
                    resolve(result as T[]);
                });
            });
        });
    }
}