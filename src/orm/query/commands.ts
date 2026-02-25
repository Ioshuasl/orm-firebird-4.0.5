import { QueryResult, TableInput, ModelStatic } from './types';
import { WhereBuilder } from './where';

export class CommandBuilder {
    /**
     * Resolve o nome da tabela a partir de uma string ou de um Model
     */
    private static resolveTableName(input: TableInput): string {
        if (typeof input === 'string') return input.toUpperCase();
        return (input as ModelStatic).tableName.toUpperCase();
    }

    /**
     * INSERT com RETURNING *
     */
    public static insert(table: TableInput, data: Record<string, any>): QueryResult {
        const tableName = this.resolveTableName(table);
        const keys = Object.keys(data).map(k => k.toUpperCase());
        const placeholders = keys.map(() => '?').join(', ');
        
        return {
            sql: `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
            params: Object.values(data)
        };
    }

    /**
     * UPDATE com RETURNING *
     */
    public static update(table: TableInput, data: Record<string, any>, where: Record<string, any>): QueryResult {
        const tableName = this.resolveTableName(table);
        const setSql = Object.keys(data).map(k => `${k.toUpperCase()} = ?`).join(', ');
        
        // No update simples, geralmente não usamos Alias T1 para evitar problemas com sintaxe de UPDATE
        const { sql: whereSql, params: whereParams } = WhereBuilder.build(where, '');
        
        return {
            sql: `UPDATE ${tableName} SET ${setSql}${whereSql} RETURNING *`,
            params: [...Object.values(data), ...whereParams]
        };
    }

    /**
     * DELETE
     */
    public static delete(table: TableInput, where: Record<string, any>): QueryResult {
        const tableName = this.resolveTableName(table);
        const { sql: whereSql, params } = WhereBuilder.build(where, '');
        
        return {
            sql: `DELETE FROM ${tableName}${whereSql}`,
            params
        };
    }
}