import { QueryResult, TableInput, ModelStatic } from './types';
import { WhereBuilder } from './where';
import { sanitizeIdentifier } from '../sql-utils';

export class CommandBuilder {
    /**
     * Resolve o nome da tabela a partir de uma string ou de um Model
     */
    private static resolveTableName(input: TableInput): string {
        if (typeof input === 'string') return sanitizeIdentifier(input, 'table');
        return sanitizeIdentifier((input as ModelStatic).tableName, 'table');
    }

    /**
     * INSERT com RETURNING * (node-firebird: fetch do retorno corrigido em `transaction.js`).
     */
    public static insert(table: TableInput, data: Record<string, any>): QueryResult {
        const tableName = this.resolveTableName(table);
        const keys = Object.keys(data).map(k => sanitizeIdentifier(k, 'column'));
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
        const setSql = Object.keys(data).map(k => `${sanitizeIdentifier(k, 'column')} = ?`).join(', ');
        
        // No update simples, geralmente não usamos Alias T1 para evitar problemas com sintaxe de UPDATE
        const { sql: whereSql, params: whereParams } = WhereBuilder.build(where, '');
        
        return {
            sql: `UPDATE ${tableName} SET ${setSql}${whereSql} RETURNING *`,
            params: [...Object.values(data), ...whereParams]
        };
    }

    /**
     * DELETE. Com `returning: true` (padrão em bulk destroy), gera `RETURNING *` (Firebird 2.1+ / 3+)
     * para obter a quantidade de linhas e os registros deletados.
     */
    public static delete(
        table: TableInput,
        where: Record<string, any>,
        options: { returning?: boolean } = {}
    ): QueryResult {
        const tableName = this.resolveTableName(table);
        const { sql: whereSql, params } = WhereBuilder.build(where, '');
        const useReturning = options.returning !== false;

        return {
            sql: useReturning
                ? `DELETE FROM ${tableName}${whereSql} RETURNING *`
                : `DELETE FROM ${tableName}${whereSql}`,
            params
        };
    }
}