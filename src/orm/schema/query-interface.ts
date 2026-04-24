import { Connection } from '../connection';
import { ColumnOptions } from '../data-types';
import { sanitizeIdentifier } from '../sql-utils';
import { buildCreateTableDdl, buildForeignKeyConstraintDdl } from './column-ddl';
import type { ForeignKeyModelSpec } from './types';
import {
    describeTable,
    findMatchingForeignKey,
    listForeignKeys,
    listSchemas,
    listUserTables,
    showConstraints,
    showIndexes,
    tableExists
} from './introspect';
import type {
    FirebirdColumnDescription,
    FirebirdConstraintInfo,
    FirebirdForeignKeyInfo,
    FirebirdIndexInfo
} from './types';
export { findMatchingForeignKey } from './introspect';

export type TruncateTableOptions = {
    restartIdentity?: boolean;
    logging?: boolean;
    /**
     * Firebird não possui `TRUNCATE ... CASCADE` como no Postgres.
     * Mantido para compatibilidade de assinatura.
     */
    cascade?: boolean;
    /**
     * Se true (padrão), ignora falha ao reiniciar IDENTITY em versões sem suporte.
     */
    ignoreIdentityRestartErrors?: boolean;
};

export type RenameTableOptions = {
    logging?: boolean;
    ifExists?: boolean;
};

export type RemoveIndexOptions = {
    logging?: boolean;
    ifExists?: boolean;
};

export class QueryInterface {
    constructor(private readonly connection: Connection) {}

    public getConnection(): Connection {
        return this.connection;
    }

    public listTables(tx?: any): Promise<string[]> {
        return listUserTables(this.connection, tx);
    }

    public listSchemas(tx?: any): Promise<string[]> {
        return listSchemas(this.connection, tx);
    }

    public tableExists(name: string, tx?: any): Promise<boolean> {
        return tableExists(this.connection, name, tx);
    }

    public describeTable(tableName: string, tx?: any): Promise<FirebirdColumnDescription[]> {
        return describeTable(this.connection, tableName, tx);
    }

    public listForeignKeys(tx?: any): Promise<FirebirdForeignKeyInfo[]> {
        return listForeignKeys(this.connection, tx);
    }

    public showConstraints(tableName?: string, tx?: any): Promise<FirebirdConstraintInfo[]> {
        return showConstraints(this.connection, tableName, tx);
    }

    public showIndexes(tableName?: string, tx?: any): Promise<FirebirdIndexInfo[]> {
        return showIndexes(this.connection, tableName, tx);
    }

    public async addForeignKey(spec: ForeignKeyModelSpec, tx?: any, logging?: boolean): Promise<void> {
        const sql = buildForeignKeyConstraintDdl(spec.childTable, [spec]) + ';';
        await this.connection.execute(sql, [], tx, { logging: !!logging, benchmark: false });
    }

    public async createTable(
        table: string,
        attrKeys: string[],
        schema: Record<string, ColumnOptions>,
        tx?: any,
        options?: { useIdentity?: boolean; logging?: boolean }
    ): Promise<void> {
        const sql =
            buildCreateTableDdl(table, attrKeys, schema, { useIdentity: options?.useIdentity !== false }) + ';';
        await this.connection.execute(sql, [], tx, { logging: options?.logging, benchmark: false });
    }

    public async dropTable(table: string, tx?: any, logging?: boolean): Promise<void> {
        const t = sanitizeIdentifier(String(table), 'table');
        const exists = await this.tableExists(t, tx);
        if (!exists) return;
        const sql = `DROP TABLE ${t};`;
        await this.connection.execute(sql, [], tx, { logging: !!logging, benchmark: false });
    }

    public async truncateTable(
        table: string,
        options: TruncateTableOptions = {},
        tx?: any
    ): Promise<void> {
        const t = sanitizeIdentifier(String(table), 'table');
        const sql = `DELETE FROM ${t};`;
        await this.connection.execute(sql, [], tx, { logging: options.logging, benchmark: false });

        if (options.restartIdentity) {
            await this.restartIdentityColumns(t, !!options.ignoreIdentityRestartErrors, tx, options.logging);
        }
    }

    public async renameTable(
        fromTable: string,
        toTable: string,
        options: RenameTableOptions = {},
        tx?: any
    ): Promise<void> {
        const from = sanitizeIdentifier(String(fromTable), 'from table');
        const to = sanitizeIdentifier(String(toTable), 'to table');

        const fromExists = await this.tableExists(from, tx);
        if (!fromExists) {
            if (options.ifExists) return;
            throw new Error(`Table "${from}" does not exist.`);
        }

        const toExists = await this.tableExists(to, tx);
        if (toExists) {
            throw new Error(`Cannot rename table "${from}" to "${to}": target already exists.`);
        }

        const sql = `ALTER TABLE ${from} RENAME TO ${to};`;
        await this.connection.execute(sql, [], tx, { logging: options.logging, benchmark: false });
    }

    public async removeIndex(
        table: string,
        indexName: string,
        options: RemoveIndexOptions = {},
        tx?: any
    ): Promise<void> {
        const t = sanitizeIdentifier(String(table), 'table');
        const i = sanitizeIdentifier(String(indexName), 'index');
        const indexes = await this.showIndexes(t, tx);
        const exists = indexes.some((idx) => idx.indexName === i);
        if (!exists && options.ifExists) return;
        if (!exists) throw new Error(`Index "${i}" does not exist on table "${t}".`);

        const sql = `DROP INDEX ${i};`;
        await this.connection.execute(sql, [], tx, { logging: options.logging, benchmark: false });
    }

    private async restartIdentityColumns(
        table: string,
        ignoreErrors: boolean,
        tx?: any,
        logging?: boolean
    ): Promise<void> {
        const sql = `
            SELECT TRIM(rf.RDB$FIELD_NAME) AS CNAME
            FROM RDB$RELATION_FIELDS rf
            JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
            WHERE UPPER(TRIM(rf.RDB$RELATION_NAME)) = ?
              AND f.RDB$IDENTITY_TYPE IS NOT NULL
            ORDER BY rf.RDB$FIELD_POSITION
        `;
        const identityRows = await this.connection.execute<Record<string, any>>(sql, [table], tx, {
            logging,
            benchmark: false
        });

        for (const row of identityRows || []) {
            const column = sanitizeIdentifier((row as any).CNAME || (row as any).cname, 'identity column');
            const restartSql = `ALTER TABLE ${table} ALTER COLUMN ${column} RESTART WITH 1;`;
            try {
                await this.connection.execute(restartSql, [], tx, { logging, benchmark: false });
            } catch (err) {
                if (!ignoreErrors) throw err;
            }
        }
    }
}
