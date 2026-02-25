import { QueryOptions, QueryResult, TableInput } from './query/types';
import { WhereBuilder } from './query/where';
import { SelectBuilder } from './query/select';
import { CommandBuilder } from './query/commands';

export { QueryOptions, QueryResult };

export class QueryBuilder {
    public static select(table: string, options: QueryOptions = {}): QueryResult {
        return SelectBuilder.build(table, options);
    }

    public static count(table: string, options: QueryOptions = {}): QueryResult {
        const { sql: whereSql, params } = WhereBuilder.build(options.where, 'T1');
        return {
            sql: `SELECT COUNT(*) AS TOTAL FROM ${table.toUpperCase()} T1${whereSql}`,
            params
        };
    }

    public static insert(table: TableInput, data: Record<string, any>): QueryResult {
        return CommandBuilder.insert(table, data);
    }

    public static update(table: TableInput, data: Record<string, any>, where: Record<string, any>): QueryResult {
        return CommandBuilder.update(table, data, where);
    }

    public static delete(table: TableInput, where: Record<string, any>): QueryResult {
        return CommandBuilder.delete(table, where);
    }
}