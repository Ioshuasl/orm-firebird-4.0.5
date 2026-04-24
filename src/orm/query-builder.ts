import { QueryOptions, QueryResult, TableInput } from './query/types';
import { WhereBuilder } from './query/where';
import { SelectBuilder } from './query/select';
import { CommandBuilder } from './query/commands';
import { sanitizeIdentifier } from './sql-utils';

export { QueryOptions, QueryResult };

export class QueryBuilder {
    private static resolveTableName(input: TableInput): string {
        if (typeof input === 'string') return sanitizeIdentifier(input, 'table');
        return sanitizeIdentifier(input.tableName, 'table');
    }

    public static select(table: TableInput, options: QueryOptions = {}): QueryResult {
        return SelectBuilder.build(table, options);
    }

    public static count(table: TableInput, options: QueryOptions = {}): QueryResult {
        const { sql: whereSql, params } = WhereBuilder.build(options.where, 'T1');
        return {
            sql: `SELECT COUNT(*) AS TOTAL FROM ${this.resolveTableName(table)} T1${whereSql}`,
            params
        };
    }

    public static insert(table: TableInput, data: Record<string, any>): QueryResult {
        return CommandBuilder.insert(table, data);
    }

    public static update(table: TableInput, data: Record<string, any>, where: Record<string, any>): QueryResult {
        return CommandBuilder.update(table, data, where);
    }

    public static delete(
        table: TableInput,
        where: Record<string, any>,
        cmdOptions?: { returning?: boolean }
    ): QueryResult {
        return CommandBuilder.delete(table, where, cmdOptions);
    }
}