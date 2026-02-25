import * as Firebird from 'node-firebird';
import * as dotenv from 'dotenv';

dotenv.config();

export class FirebirdDB {
    private static pool: Firebird.ConnectionPool;

    private static config: Firebird.Options = {
        host: process.env.FDB_HOST,
        port: parseInt(process.env.FDB_PORT || '3050'),
        // No Firebird 4, usar o Alias (IOSHUA) é mais seguro que o caminho físico
        database: process.env.FDB_DATABASE, 
        user: process.env.FDB_USER,
        password: process.env.FDB_PASSWORD,
        lowercase_keys: false,
        pageSize: 4096
    };

    public static getPool(): Firebird.ConnectionPool {
        if (!this.pool) {
            // Configurado de acordo com seu firebird.conf (ExtConnPoolSize)
            const max = parseInt(process.env.FDB_POOL_SIZE || '10');
            this.pool = Firebird.pool(max, this.config);
            console.log('🔥 Pool Firebird 4.0 (SuperServer) inicializado via Alias.');
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