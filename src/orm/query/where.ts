import { QueryResult } from './types';
import { sanitizeIdentifier } from '../sql-utils';

type WhereInput = Record<string | symbol, any> | undefined;

export class WhereBuilder {
    public static build(where?: Record<string | symbol, any>, alias: string = 'T1'): QueryResult {
        const params: any[] = [];
        const expression = this.buildExpression(where, alias, params);
        return {
            sql: expression ? ` WHERE ${expression}` : '',
            params
        };
    }

    private static buildExpression(where: WhereInput, alias: string, params: any[]): string {
        if (!where) return '';

        const parts: string[] = [];
        const prefix = alias ? `${sanitizeIdentifier(alias, 'alias')}.` : '';

        for (const [key, value] of Object.entries(where)) {
            const column = `${prefix}${sanitizeIdentifier(key, 'column')}`;
            parts.push(this.buildColumnExpression(column, value, params));
        }

        for (const symbol of Object.getOwnPropertySymbols(where)) {
            const operator = symbol.description?.toUpperCase();
            const value = (where as any)[symbol];

            if (operator !== 'AND' && operator !== 'OR') continue;

            const logicalParts = Array.isArray(value) ? value : [value];
            const nested = logicalParts
                .map((entry) => this.buildExpression(entry, alias, params))
                .filter(Boolean)
                .map((entry) => `(${entry})`);

            if (nested.length > 0) {
                parts.push(nested.join(` ${operator} `));
            }
        }

        return parts.join(' AND ');
    }

    private static buildColumnExpression(column: string, value: any, params: any[]): string {
        if (value === null) return `${column} IS NULL`;
        if (value === undefined) return `${column} IS NULL`;

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const clauses: string[] = [];
            const operatorSymbols = Object.getOwnPropertySymbols(value);

            for (const sym of operatorSymbols) {
                const operator = sym.description?.toUpperCase() || '=';
                const val = value[sym];
                clauses.push(this.buildOperatorExpression(column, operator, val, params));
            }

            if (clauses.length === 0) {
                params.push(value);
                return `${column} = ?`;
            }

            return clauses.length === 1 ? clauses[0] : `(${clauses.join(' AND ')})`;
        }

        params.push(value);
        return `${column} = ?`;
    }

    private static buildOperatorExpression(column: string, operator: string, value: any, params: any[]): string {
        if (operator === 'IS') {
            return value === null ? `${column} IS NULL` : `${column} IS ?`;
        }

        if (operator === 'NOT') {
            if (value === null) return `${column} IS NOT NULL`;
            params.push(value);
            return `${column} <> ?`;
        }

        if (value === null) {
            return operator === '=' ? `${column} IS NULL` : `${column} IS NOT NULL`;
        }

        if (operator === 'BETWEEN' || operator === 'NOT BETWEEN') {
            if (!Array.isArray(value) || value.length !== 2) {
                throw new Error(`${operator} requires an array with two values.`);
            }
            params.push(value[0], value[1]);
            return `${column} ${operator} ? AND ?`;
        }

        if (operator === 'IN' || operator === 'NOT IN') {
            if (!Array.isArray(value) || value.length === 0) {
                throw new Error(`${operator} requires a non-empty array.`);
            }
            const placeholders = value.map(() => '?').join(', ');
            params.push(...value);
            return `${column} ${operator} (${placeholders})`;
        }

        params.push(value);
        return `${column} ${operator} ?`;
    }
}