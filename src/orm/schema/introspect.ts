import { Connection } from '../connection';
import type {
    FirebirdColumnDescription,
    FirebirdConstraintInfo,
    FirebirdForeignKeyInfo,
    FirebirdIndexInfo,
    ReferentialAction
} from './types';

function trimV(value: any): string {
    if (value === null || value === undefined) return '';
    if (Buffer.isBuffer(value)) return value.toString('utf8').trim();
    return String(value).trim();
}

/**
 * FKs reais (coluna simples) em um banco Firebird, via dicionário RDB$*.
 */
export async function listUserTables(connection: Connection, tx?: any): Promise<string[]> {
    const sql = `
    SELECT TRIM(r.RDB$RELATION_NAME) AS TNAME
    FROM RDB$RELATIONS r
    WHERE r.RDB$SYSTEM_FLAG = 0
      AND r.RDB$VIEW_BLR IS NULL
    ORDER BY 1
  `;
    const rows = await connection.execute<Record<string, any>>(sql, [], tx);
    return (rows as any).map((r: any) => trimV((r as any).TNAME || (r as any).tname || Object.values(r)[0])).filter(Boolean);
}

export async function listSchemas(_connection: Connection, _tx?: any): Promise<string[]> {
    // Firebird não possui schema namespace como Postgres; usamos um schema lógico padrão.
    return ['PUBLIC'];
}

export async function tableExists(
    connection: Connection,
    tableName: string,
    tx?: any
): Promise<boolean> {
    const t = String(tableName).toUpperCase().trim();
    const sql = `
    SELECT 1
    FROM RDB$RELATIONS r
    WHERE r.RDB$SYSTEM_FLAG = 0
      AND r.RDB$VIEW_BLR IS NULL
      AND UPPER(TRIM(r.RDB$RELATION_NAME)) = ?
  `;
    const rows = await connection.execute<Record<string, any>>(sql, [t], tx, {});
    return Array.isArray(rows) && rows.length > 0;
}

/**
 * Lista FKs (RDB$*; Firebird 2.5+). Regras ON UPDATE/DELETE: quando acessíveis (FB3+);
 * caso contrário, `NO ACTION` (diferenças de regra em relação ao model não forçam re-sync ainda).
 */
export async function listForeignKeys(
    connection: Connection,
    tx?: any
): Promise<FirebirdForeignKeyInfo[]> {
    const sql = `
    SELECT
      TRIM(RC_FK.RDB$CONSTRAINT_NAME) AS CNAME,
      TRIM(RC_FK.RDB$RELATION_NAME) AS CH_TAB,
      TRIM(SEG_FK.RDB$FIELD_NAME) AS CH_FLD,
      TRIM(RC_UQ.RDB$RELATION_NAME) AS PA_TAB,
      TRIM(SEG_UQ.RDB$FIELD_NAME) AS PA_FLD,
      COALESCE(SEG_FK.RDB$FIELD_POSITION, 0) AS SEG_POS
    FROM RDB$RELATION_CONSTRAINTS RC_FK
    JOIN RDB$REF_CONSTRAINTS RREF ON RREF.RDB$CONSTRAINT_NAME = RC_FK.RDB$CONSTRAINT_NAME
    JOIN RDB$RELATION_CONSTRAINTS RC_UQ ON RC_UQ.RDB$CONSTRAINT_NAME = RREF.RDB$CONST_NAME_UQ
    JOIN RDB$INDEX_SEGMENTS SEG_FK ON SEG_FK.RDB$INDEX_NAME = RC_FK.RDB$INDEX_NAME
    JOIN RDB$INDEX_SEGMENTS SEG_UQ
      ON SEG_UQ.RDB$INDEX_NAME = RC_UQ.RDB$INDEX_NAME
     AND SEG_UQ.RDB$FIELD_POSITION = SEG_FK.RDB$FIELD_POSITION
    WHERE RC_FK.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
      AND RC_FK.RDB$SYSTEM_FLAG = 0
  `;
    const rows = await connection.execute<Record<string, any>>(sql, [], tx);
    const out: FirebirdForeignKeyInfo[] = [];
    for (const r of (rows as any) || []) {
        const cname = trimV((r as any).CNAME || (r as any).cname);
        out.push({
            constraintName: cname,
            childTable: trimV((r as any).CH_TAB || (r as any).ch_tab).toUpperCase(),
            childField: trimV((r as any).CH_FLD || (r as any).ch_fld).toUpperCase(),
            parentTable: trimV((r as any).PA_TAB || (r as any).pa_tab).toUpperCase(),
            parentField: trimV((r as any).PA_FLD || (r as any).pa_fld).toUpperCase(),
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
            segmentPosition: Number((r as any).SEG_POS ?? (r as any).seg_pos ?? 0)
        });
    }
    return out;
}

export async function describeTable(
    connection: Connection,
    tableName: string,
    tx?: any
): Promise<FirebirdColumnDescription[]> {
    const table = String(tableName).toUpperCase().trim();
    const sql = `
    SELECT
      TRIM(rf.RDB$RELATION_NAME) AS TNAME,
      TRIM(rf.RDB$FIELD_NAME) AS CNAME,
      COALESCE(f.RDB$FIELD_TYPE, -1) AS FTYPE,
      COALESCE(f.RDB$FIELD_SUB_TYPE, 0) AS FSUBTYPE,
      COALESCE(f.RDB$FIELD_LENGTH, 0) AS FLENGTH,
      COALESCE(f.RDB$FIELD_PRECISION, 0) AS FPREC,
      COALESCE(f.RDB$FIELD_SCALE, 0) AS FSCALE,
      COALESCE(rf.RDB$NULL_FLAG, 0) AS NNULL,
      TRIM(COALESCE(rf.RDB$DEFAULT_SOURCE, f.RDB$DEFAULT_SOURCE)) AS DEF_SRC,
      COALESCE(rf.RDB$FIELD_POSITION, 0) AS FPOS
    FROM RDB$RELATION_FIELDS rf
    JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
    WHERE UPPER(TRIM(rf.RDB$RELATION_NAME)) = ?
    ORDER BY rf.RDB$FIELD_POSITION
  `;
    const rows = await connection.execute<Record<string, any>>(sql, [table], tx);
    return ((rows as any[]) || []).map((r) => {
        const fieldType = Number((r as any).FTYPE ?? (r as any).ftype ?? -1);
        const fieldSubType = Number((r as any).FSUBTYPE ?? (r as any).fsubtype ?? 0);
        return {
            tableName: trimV((r as any).TNAME || (r as any).tname).toUpperCase(),
            columnName: trimV((r as any).CNAME || (r as any).cname).toUpperCase(),
            dataType: mapFirebirdFieldType(fieldType, fieldSubType),
            nullable: Number((r as any).NNULL ?? (r as any).nnull ?? 0) === 0,
            defaultValue: trimV((r as any).DEF_SRC || (r as any).def_src) || null,
            length: Number((r as any).FLENGTH ?? (r as any).flength ?? 0) || undefined,
            precision: Number((r as any).FPREC ?? (r as any).fprec ?? 0) || undefined,
            scale: Number((r as any).FSCALE ?? (r as any).fscale ?? 0) || undefined,
            position: Number((r as any).FPOS ?? (r as any).fpos ?? 0)
        } as FirebirdColumnDescription;
    });
}

export async function showConstraints(
    connection: Connection,
    tableName?: string,
    tx?: any
): Promise<FirebirdConstraintInfo[]> {
    const hasTableFilter = !!tableName;
    const sql = `
    SELECT
      TRIM(rc.RDB$CONSTRAINT_NAME) AS CNAME,
      TRIM(rc.RDB$RELATION_NAME) AS TNAME,
      TRIM(rc.RDB$CONSTRAINT_TYPE) AS CTYPE,
      TRIM(rc.RDB$INDEX_NAME) AS INAME,
      TRIM(rf.RDB$CONST_NAME_UQ) AS REF_CNAME
    FROM RDB$RELATION_CONSTRAINTS rc
    LEFT JOIN RDB$REF_CONSTRAINTS rf ON rf.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
    WHERE rc.RDB$SYSTEM_FLAG = 0
      ${hasTableFilter ? 'AND UPPER(TRIM(rc.RDB$RELATION_NAME)) = ?' : ''}
    ORDER BY rc.RDB$RELATION_NAME, rc.RDB$CONSTRAINT_NAME
  `;
    const params = hasTableFilter ? [String(tableName).toUpperCase().trim()] : [];
    const rows = await connection.execute<Record<string, any>>(sql, params, tx);
    return ((rows as any[]) || []).map((r) => ({
        constraintName: trimV((r as any).CNAME || (r as any).cname).toUpperCase(),
        tableName: trimV((r as any).TNAME || (r as any).tname).toUpperCase(),
        type: trimV((r as any).CTYPE || (r as any).ctype).toUpperCase(),
        indexName: trimV((r as any).INAME || (r as any).iname) || null,
        referencedConstraintName: trimV((r as any).REF_CNAME || (r as any).ref_cname) || null
    }));
}

export async function showIndexes(
    connection: Connection,
    tableName?: string,
    tx?: any
): Promise<FirebirdIndexInfo[]> {
    const hasTableFilter = !!tableName;
    const sql = `
    SELECT
      TRIM(i.RDB$INDEX_NAME) AS INAME,
      TRIM(i.RDB$RELATION_NAME) AS TNAME,
      COALESCE(i.RDB$UNIQUE_FLAG, 0) AS IUNIQ,
      COALESCE(i.RDB$INDEX_TYPE, 0) AS ITYPE,
      TRIM(s.RDB$FIELD_NAME) AS CNAME,
      COALESCE(s.RDB$FIELD_POSITION, 0) AS CPOS
    FROM RDB$INDICES i
    JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = i.RDB$INDEX_NAME
    WHERE COALESCE(i.RDB$SYSTEM_FLAG, 0) = 0
      ${hasTableFilter ? 'AND UPPER(TRIM(i.RDB$RELATION_NAME)) = ?' : ''}
    ORDER BY i.RDB$RELATION_NAME, i.RDB$INDEX_NAME, s.RDB$FIELD_POSITION
  `;
    const params = hasTableFilter ? [String(tableName).toUpperCase().trim()] : [];
    const rows = await connection.execute<Record<string, any>>(sql, params, tx);

    const map = new Map<string, FirebirdIndexInfo>();
    for (const row of (rows as any[]) || []) {
        const indexName = trimV((row as any).INAME || (row as any).iname).toUpperCase();
        const table = trimV((row as any).TNAME || (row as any).tname).toUpperCase();
        const unique = Number((row as any).IUNIQ ?? (row as any).iuniq ?? 0) === 1;
        const indexTypeNum = Number((row as any).ITYPE ?? (row as any).itype ?? 0);
        const indexType = indexTypeNum === 1 ? 'DESC' : 'ASC';
        const column = trimV((row as any).CNAME || (row as any).cname).toUpperCase();

        const key = `${table}::${indexName}`;
        const existing = map.get(key);
        if (existing) {
            existing.columns.push(column);
            continue;
        }

        map.set(key, {
            indexName,
            tableName: table,
            unique,
            indexType,
            columns: [column]
        });
    }

    return Array.from(map.values());
}

/**
 * Verifica se já existe qualquer FK lógica equivalente (child+col+parent+parenCol).
 * Coluna composta: exige o mesmo specKey para todos os segmentos (não implementado aqui).
 */
export function findMatchingForeignKey(
    existing: FirebirdForeignKeyInfo[],
    spec: {
        childTable: string;
        childField: string;
        parentTable: string;
        parentField: string;
    }
): FirebirdForeignKeyInfo | undefined {
    const c = (s: string) => s.toUpperCase().trim();
    return existing.find(
        (e) =>
            c(e.childTable) === c(spec.childTable) &&
            c(e.childField) === c(spec.childField) &&
            c(e.parentTable) === c(spec.parentTable) &&
            c(e.parentField) === c(spec.parentField) &&
            e.segmentPosition === 0
    );
}

function mapFirebirdFieldType(fieldType: number, subType: number): string {
    // Baseado em constantes clássicas do Firebird (RDB$FIELDS.RDB$FIELD_TYPE).
    switch (fieldType) {
        case 7:
            return subType === 1 ? 'NUMERIC' : 'SMALLINT';
        case 8:
            return subType === 1 ? 'NUMERIC' : 'INTEGER';
        case 10:
            return 'FLOAT';
        case 12:
            return 'DATE';
        case 13:
            return 'TIME';
        case 14:
            return 'CHAR';
        case 16:
            if (subType === 1) return 'NUMERIC';
            if (subType === 2) return 'DECIMAL';
            return 'BIGINT';
        case 23:
            return 'BOOLEAN';
        case 24:
            return 'DECFLOAT';
        case 27:
            return 'DOUBLE';
        case 35:
            return 'TIMESTAMP';
        case 37:
            return 'VARCHAR';
        case 261:
            return 'BLOB';
        default:
            return `TYPE_${fieldType}`;
    }
}
