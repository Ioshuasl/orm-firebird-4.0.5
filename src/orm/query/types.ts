// src/orm/query/types.ts

export type ModelStatic = {
    tableName: string;
} & (new (values?: any) => any);

export type TableInput = string | ModelStatic;

export interface IncludeOptions {
    model?: ModelStatic; // Agora aceita o Model
    table?: string;      // Ou a string (legado/flexibilidade)
    as?: string;
    on: [string, string];
    attributes?: string[];
}

export interface QueryOptions {
    where?: Record<string, any>;
    limit?: number;
    offset?: number;
    order?: [string, 'ASC' | 'DESC'][];
    attributes?: string[];
    include?: IncludeOptions[];
}

export interface QueryResult {
    sql: string;
    params: any[];
}