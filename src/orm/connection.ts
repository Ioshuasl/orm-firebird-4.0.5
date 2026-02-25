import * as Firebird from 'node-firebird';

export class Connection {
    private pool: Firebird.ConnectionPool;

    constructor(config: Firebird.Options, maxPool: number = 10) {
        this.pool = Firebird.pool(maxPool, config);
        console.log('🔥 ORM: Conexão com Firebird inicializada.');
    }

    public async execute<T>(sql: string, params: any[] = []): Promise<T[]> {
        return new Promise((resolve, reject) => {
            this.pool.get((err, db) => {
                if (err) return reject(err);
                
                db.query(sql, params, (queryErr, result) => {
                    db.detach(); // Devolve ao pool 
                    if (queryErr) return reject(queryErr);
                    resolve(result as T[]);
                });
            });
        });
    }
}