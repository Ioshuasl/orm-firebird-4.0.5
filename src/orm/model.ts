import { QueryBuilder, QueryOptions } from './query-builder';
import { DataType, ColumnOptions } from './data-types';

export abstract class Model {
    protected static tableName: string;
    protected static primaryKey: string = 'ID';
    protected static schema: Record<string, ColumnOptions> = {};
    protected static connection: any;

    public dataValues: any = {};

    constructor(values: any = {}) {
        this.dataValues = values;
    }

    public static setConnection(conn: any) {
        this.connection = conn;
    }

    /**
     * Busca o próximo valor de um Generator/Sequence no Firebird.
     * Útil para tabelas que não usam IDENTITY (comum em bancos legados).
     */
    protected static async getNextSequenceValue(sequenceName: string): Promise<number> {
        const sql = `SELECT NEXT VALUE FOR ${sequenceName.toUpperCase()} FROM RDB$DATABASE AS NEXT_VAL FROM RDB$DATABASE`;
        // Nota: Ajustamos a query para garantir compatibilidade de sintaxe
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
                            const isText = schema[key]?.type === DataType.TEXT;
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

    public static async findAll<T extends Model>(this: new (v: any) => T, options: QueryOptions = {}): Promise<T[]> {
        const modelClass = this as any;
        const { sql, params } = QueryBuilder.select(modelClass, options);
        const results = await modelClass.connection.execute(sql, params);

        const hydratedResults = await Promise.all(results.map((row: any) => modelClass.hydrate(row)));
        return hydratedResults.map((row: any) => new this(row));
    }

    public static async findOne<T extends Model>(this: new (v: any) => T, options: QueryOptions = {}): Promise<T | null> {
        const results = await (this as any).findAll({ ...options, limit: 1 });
        return results.length > 0 ? results[0] : null;
    }

    public static async count(options: QueryOptions = {}): Promise<number> {
        const modelClass = this as any;
        const { sql, params } = QueryBuilder.count(modelClass, options);
        const result = await modelClass.connection.execute(sql, params);
        return result[0]?.TOTAL || 0;
    }

    // --- MÉTODOS DE INSTÂNCIA ---

    // No src/orm/model.ts, ajuste o método save:

    public async save(): Promise<this> {
        const modelClass = this.constructor as any;
        const pkField = modelClass.primaryKey;
        const pkValue = this.dataValues[pkField];

        let result;

        if (pkValue) {
            // UPDATE
            const { [pkField]: _, ...updateData } = this.dataValues;
            const { sql, params } = QueryBuilder.update(modelClass, updateData, { [pkField]: pkValue });
            result = await modelClass.connection.execute(sql, params);

            if (result && result.length > 0) {
                const hydrated = await modelClass.hydrate(result[0]);
                this.dataValues = { ...this.dataValues, ...hydrated };
            }
        } else {
            // INSERT
            const insertData = { ...this.dataValues };

            for (const key in modelClass.schema) {
                const config = modelClass.schema[key];

                if (config.autoIncrement && !insertData[key]) {
                    if (config.sequence) {
                        const seqSql = `SELECT NEXT VALUE FOR ${config.sequence.toUpperCase()} FROM RDB$DATABASE`;
                        const seqRes = await modelClass.connection.execute(seqSql);
                        insertData[key] = seqRes[0].NEXT_VALUE || Object.values(seqRes[0])[0];
                    } else {
                        // Fallback: MAX + 1
                        const maxSql = `SELECT MAX(${key.toUpperCase()}) AS MAX_ID FROM ${modelClass.tableName.toUpperCase()}`;
                        const maxRes = await modelClass.connection.execute(maxSql);
                        const currentMax = maxRes[0].MAX_ID || 0;
                        // Garantimos que o ID seja tratado como Number para evitar problemas com BIGINT
                        insertData[key] = Number(currentMax) + 1;
                        console.log(`🔢 ID Calculado manualmente para ${key}: ${insertData[key]}`);
                    }
                }
            }

            const { sql, params } = QueryBuilder.insert(modelClass, insertData);
            result = await modelClass.connection.execute(sql, params);

            // CORREÇÃO AQUI: Priorizamos os dados que enviamos (insertData) 
            // e mesclamos com o que o banco retornou (result[0])
            const dbData = (result && result.length > 0) ? await modelClass.hydrate(result[0]) : {};

            // Mesclagem inteligente: mantém o que enviamos e atualiza com o que o banco trouxe
            this.dataValues = { ...insertData, ...dbData };
        }

        return this;
    }

    public async delete(): Promise<void> {
        const modelClass = this.constructor as any;
        const pkField = modelClass.primaryKey;
        const pkValue = this.dataValues[pkField];

        if (!pkValue) throw new Error("Não é possível deletar: Chave primária ausente.");

        const { sql, params } = QueryBuilder.delete(modelClass, { [pkField]: pkValue });
        await modelClass.connection.execute(sql, params);
        this.dataValues = {};
    }
}