import { QueryResult } from './types';

export class WhereBuilder {
    public static build(where?: Record<string, any>, alias: string = 'T1'): QueryResult {
        if (!where || Object.keys(where).length === 0) return { sql: '', params: [] };

        const params: any[] = [];
        const parts: string[] = [];
        const prefix = alias ? `${alias}.` : '';

        for (const [key, value] of Object.entries(where)) {
            const column = `${prefix}${key.toUpperCase()}`;

            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                const operatorSymbols = Object.getOwnPropertySymbols(value);

                for (const sym of operatorSymbols) {
                    const operator = sym.description;
                    const val = value[sym];

                    if (val === null) {
                        parts.push(operator === '=' ? `${column} IS NULL` : `${column} IS NOT NULL`);
                        continue;
                    }

                    if (operator === 'BETWEEN') {
                        parts.push(`${column} BETWEEN ? AND ?`);
                        params.push(val[0], val[1]);
                    } else if (operator === 'IN' || operator === 'NOT IN') {
                        const placeholders = val.map(() => '?').join(', ');
                        parts.push(`${column} ${operator} (${placeholders})`);
                        params.push(...val);
                    } else {
                        parts.push(`${column} ${operator} ?`);
                        params.push(val);
                    }
                }
            } else {
                if (value === null) parts.push(`${column} IS NULL`);
                else {
                    parts.push(`${column} = ?`);
                    params.push(value);
                }
            }
        }

        return {
            sql: parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '',
            params
        };
    }
}