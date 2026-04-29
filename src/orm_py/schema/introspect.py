from __future__ import annotations

from .types import (
    FirebirdColumnDescription,
    FirebirdConstraintInfo,
    FirebirdForeignKeyInfo,
    FirebirdIndexInfo,
)


def _trim(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def list_user_tables(connection, tx: object = None) -> list[str]:
    sql = """
    SELECT TRIM(r.RDB$RELATION_NAME) AS TNAME
    FROM RDB$RELATIONS r
    WHERE r.RDB$SYSTEM_FLAG = 0
      AND r.RDB$VIEW_BLR IS NULL
    ORDER BY 1
    """
    rows = connection.execute(sql, {})
    return [_trim(row.get("TNAME") or row.get("tname")) for row in rows if _trim(row.get("TNAME") or row.get("tname"))]


def list_schemas(_connection, _tx: object = None) -> list[str]:
    return ["PUBLIC"]


def table_exists(connection, table_name: str, tx: object = None) -> bool:
    sql = """
    SELECT 1 AS OK
    FROM RDB$RELATIONS r
    WHERE r.RDB$SYSTEM_FLAG = 0
      AND r.RDB$VIEW_BLR IS NULL
      AND UPPER(TRIM(r.RDB$RELATION_NAME)) = :table_name
    """
    rows = connection.execute(sql, {"table_name": table_name.strip().upper()})
    return len(rows) > 0


def list_foreign_keys(connection, tx: object = None) -> list[FirebirdForeignKeyInfo]:
    sql = """
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
    """
    rows = connection.execute(sql, {})
    out: list[FirebirdForeignKeyInfo] = []
    for row in rows:
        out.append(
            FirebirdForeignKeyInfo(
                constraint_name=_trim(row.get("CNAME") or row.get("cname")).upper(),
                child_table=_trim(row.get("CH_TAB") or row.get("ch_tab")).upper(),
                child_field=_trim(row.get("CH_FLD") or row.get("ch_fld")).upper(),
                parent_table=_trim(row.get("PA_TAB") or row.get("pa_tab")).upper(),
                parent_field=_trim(row.get("PA_FLD") or row.get("pa_fld")).upper(),
                on_delete="NO ACTION",
                on_update="NO ACTION",
                segment_position=int(row.get("SEG_POS") or row.get("seg_pos") or 0),
            )
        )
    return out


def describe_table(connection, table_name: str, tx: object = None) -> list[FirebirdColumnDescription]:
    sql = """
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
    WHERE UPPER(TRIM(rf.RDB$RELATION_NAME)) = :table_name
    ORDER BY rf.RDB$FIELD_POSITION
    """
    rows = connection.execute(sql, {"table_name": table_name.strip().upper()})
    out: list[FirebirdColumnDescription] = []
    for row in rows:
        ftype = int(row.get("FTYPE") or row.get("ftype") or -1)
        fsub = int(row.get("FSUBTYPE") or row.get("fsubtype") or 0)
        out.append(
            FirebirdColumnDescription(
                table_name=_trim(row.get("TNAME") or row.get("tname")).upper(),
                column_name=_trim(row.get("CNAME") or row.get("cname")).upper(),
                data_type=_map_firebird_field_type(ftype, fsub),
                nullable=int(row.get("NNULL") or row.get("nnull") or 0) == 0,
                default_value=_trim(row.get("DEF_SRC") or row.get("def_src")) or None,
                length=int(row.get("FLENGTH") or row.get("flength") or 0) or None,
                precision=int(row.get("FPREC") or row.get("fprec") or 0) or None,
                scale=int(row.get("FSCALE") or row.get("fscale") or 0) or None,
                position=int(row.get("FPOS") or row.get("fpos") or 0),
            )
        )
    return out


def show_constraints(connection, table_name: str | None = None, tx: object = None) -> list[FirebirdConstraintInfo]:
    has_filter = bool(table_name)
    sql = f"""
    SELECT
      TRIM(rc.RDB$CONSTRAINT_NAME) AS CNAME,
      TRIM(rc.RDB$RELATION_NAME) AS TNAME,
      TRIM(rc.RDB$CONSTRAINT_TYPE) AS CTYPE,
      TRIM(rc.RDB$INDEX_NAME) AS INAME,
      TRIM(rf.RDB$CONST_NAME_UQ) AS REF_CNAME
    FROM RDB$RELATION_CONSTRAINTS rc
    LEFT JOIN RDB$REF_CONSTRAINTS rf ON rf.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
    WHERE rc.RDB$SYSTEM_FLAG = 0
      {"AND UPPER(TRIM(rc.RDB$RELATION_NAME)) = :table_name" if has_filter else ""}
    ORDER BY rc.RDB$RELATION_NAME, rc.RDB$CONSTRAINT_NAME
    """
    rows = connection.execute(sql, {"table_name": table_name.strip().upper()} if has_filter else {})
    return [
        FirebirdConstraintInfo(
            constraint_name=_trim(row.get("CNAME") or row.get("cname")).upper(),
            table_name=_trim(row.get("TNAME") or row.get("tname")).upper(),
            type=_trim(row.get("CTYPE") or row.get("ctype")).upper(),
            index_name=_trim(row.get("INAME") or row.get("iname")) or None,
            referenced_constraint_name=_trim(row.get("REF_CNAME") or row.get("ref_cname")) or None,
        )
        for row in rows
    ]


def show_indexes(connection, table_name: str | None = None, tx: object = None) -> list[FirebirdIndexInfo]:
    has_filter = bool(table_name)
    sql = f"""
    SELECT
      TRIM(i.RDB$INDEX_NAME) AS INAME,
      TRIM(i.RDB$RELATION_NAME) AS TNAME,
      COALESCE(i.RDB$UNIQUE_FLAG, 0) AS IUNIQ,
      COALESCE(i.RDB$INDEX_TYPE, 0) AS ITYPE,
      TRIM(s.RDB$FIELD_NAME) AS CNAME
    FROM RDB$INDICES i
    JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = i.RDB$INDEX_NAME
    WHERE COALESCE(i.RDB$SYSTEM_FLAG, 0) = 0
      {"AND UPPER(TRIM(i.RDB$RELATION_NAME)) = :table_name" if has_filter else ""}
    ORDER BY i.RDB$RELATION_NAME, i.RDB$INDEX_NAME, s.RDB$FIELD_POSITION
    """
    rows = connection.execute(sql, {"table_name": table_name.strip().upper()} if has_filter else {})
    acc: dict[str, FirebirdIndexInfo] = {}
    for row in rows:
        index_name = _trim(row.get("INAME") or row.get("iname")).upper()
        table = _trim(row.get("TNAME") or row.get("tname")).upper()
        column = _trim(row.get("CNAME") or row.get("cname")).upper()
        key = f"{table}::{index_name}"
        if key not in acc:
            acc[key] = FirebirdIndexInfo(
                index_name=index_name,
                table_name=table,
                unique=int(row.get("IUNIQ") or row.get("iuniq") or 0) == 1,
                index_type="DESC" if int(row.get("ITYPE") or row.get("itype") or 0) == 1 else "ASC",
                columns=[],
            )
        acc[key].columns.append(column)
    return list(acc.values())


def find_matching_foreign_key(
    existing: list[FirebirdForeignKeyInfo],
    spec: dict[str, str],
) -> FirebirdForeignKeyInfo | None:
    def canon(value: str) -> str:
        return value.upper().strip()

    for item in existing:
        if (
            canon(item.child_table) == canon(spec["child_table"])
            and canon(item.child_field) == canon(spec["child_field"])
            and canon(item.parent_table) == canon(spec["parent_table"])
            and canon(item.parent_field) == canon(spec["parent_field"])
            and item.segment_position == 0
        ):
            return item
    return None


def _map_firebird_field_type(field_type: int, sub_type: int) -> str:
    if field_type == 7:
        return "NUMERIC" if sub_type == 1 else "SMALLINT"
    if field_type == 8:
        return "NUMERIC" if sub_type == 1 else "INTEGER"
    if field_type == 10:
        return "FLOAT"
    if field_type == 12:
        return "DATE"
    if field_type == 13:
        return "TIME"
    if field_type == 14:
        return "CHAR"
    if field_type == 16:
        if sub_type == 1:
            return "NUMERIC"
        if sub_type == 2:
            return "DECIMAL"
        return "BIGINT"
    if field_type == 23:
        return "BOOLEAN"
    if field_type == 24:
        return "DECFLOAT"
    if field_type == 27:
        return "DOUBLE"
    if field_type == 35:
        return "TIMESTAMP"
    if field_type == 37:
        return "VARCHAR"
    if field_type == 261:
        return "BLOB"
    return f"TYPE_{field_type}"
