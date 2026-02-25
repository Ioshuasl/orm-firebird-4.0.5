// src/orm/query/select.ts

import { QueryOptions, QueryResult, TableInput, ModelStatic } from './types';
import { WhereBuilder } from './where';

export class SelectBuilder {
    /**
     * Resolve o nome da tabela a partir de uma string ou de um Model
     */
    private static resolveTableName(input: TableInput): string {
        if (typeof input === 'string') return input.toUpperCase();
        return (input as ModelStatic).tableName.toUpperCase();
    }

    public static build(table: TableInput, options: QueryOptions): QueryResult {
        const { where, limit, offset, order, attributes, include } = options;
        const mainTableName = this.resolveTableName(table);
        const mainAlias = 'T1';
        let allParams: any[] = [];

        // 1. Projeção de Colunas
        let selectCols = attributes 
            ? attributes.map(a => `${mainAlias}.${a.toUpperCase()}`).join(', ') 
            : `${mainAlias}.*`;

        // 2. Joins (Includes)
        let joinSql = '';
        if (include) {
            include.forEach((inc, index) => {
                const joinAlias = inc.as || `J${index + 1}`;
                const joinTableName = inc.model 
                    ? this.resolveTableName(inc.model) 
                    : (inc.table?.toUpperCase() || '');

                joinSql += ` LEFT JOIN ${joinTableName} ${joinAlias} ON ${mainAlias}.${inc.on[0].toUpperCase()} = ${joinAlias}.${inc.on[1].toUpperCase()}`;
                
                const cols = inc.attributes 
                    ? inc.attributes.map(a => `${joinAlias}.${a.toUpperCase()} AS ${joinAlias}_${a.toUpperCase()}`).join(', ')
                    : `${joinAlias}.*`;
                selectCols += `, ${cols}`;
            });
        }

        const { sql: whereSql, params } = WhereBuilder.build(where, mainAlias);
        allParams.push(...params);

        let sql = `SELECT ${selectCols} FROM ${mainTableName} ${mainAlias}${joinSql}${whereSql}`;

        if (order) {
            sql += ` ORDER BY ` + order.map(([col, dir]) => `${mainAlias}.${col.toUpperCase()} ${dir}`).join(', ');
        }

        if (offset !== undefined) sql += ` OFFSET ${offset} ROWS`;
        if (limit !== undefined) sql += ` FETCH FIRST ${limit} ROWS ONLY`;

        return { sql, params: allParams };
    }
}