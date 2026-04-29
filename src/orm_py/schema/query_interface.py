from __future__ import annotations

from .column_ddl import (
    build_create_table_ddl,
    build_foreign_key_constraint_ddl,
    sanitize_identifier,
)
from .introspect import (
    describe_table,
    find_matching_foreign_key,
    list_foreign_keys,
    list_schemas,
    list_user_tables,
    show_constraints,
    show_indexes,
    table_exists,
)
from .types import ForeignKeyModelSpec


class QueryInterface:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return self.connection

    def list_tables(self, tx: object = None) -> list[str]:
        return list_user_tables(self.connection, tx)

    def list_schemas(self, tx: object = None) -> list[str]:
        return list_schemas(self.connection, tx)

    def table_exists(self, name: str, tx: object = None) -> bool:
        return table_exists(self.connection, name, tx)

    def describe_table(self, table_name: str, tx: object = None):
        return describe_table(self.connection, table_name, tx)

    def list_foreign_keys(self, tx: object = None):
        return list_foreign_keys(self.connection, tx)

    def show_constraints(self, table_name: str | None = None, tx: object = None):
        return show_constraints(self.connection, table_name, tx)

    def show_indexes(self, table_name: str | None = None, tx: object = None):
        return show_indexes(self.connection, table_name, tx)

    def add_foreign_key(self, spec: ForeignKeyModelSpec, tx: object = None, logging: bool = False) -> None:
        sql = build_foreign_key_constraint_ddl(spec.child_table, [spec]) + ";"
        self.connection.execute(sql, {})

    def create_table(
        self,
        table: str,
        attr_keys: list[str],
        schema: dict[str, dict],
        tx: object = None,
        options: dict | None = None,
    ) -> None:
        options = options or {}
        sql = (
            build_create_table_ddl(table, attr_keys, schema, {"use_identity": options.get("use_identity", True)})
            + ";"
        )
        self.connection.execute(sql, {})

    def drop_table(self, table: str, tx: object = None, logging: bool = False) -> None:
        name = sanitize_identifier(str(table), "table")
        if not self.table_exists(name, tx):
            return
        self.connection.execute(f"DROP TABLE {name};", {})

    def truncate_table(self, table: str, options: dict | None = None, tx: object = None) -> None:
        options = options or {}
        name = sanitize_identifier(str(table), "table")
        self.connection.execute(f"DELETE FROM {name};", {})
        if options.get("restart_identity"):
            self._restart_identity_columns(name, bool(options.get("ignore_identity_restart_errors", True)))

    def rename_table(
        self,
        from_table: str,
        to_table: str,
        options: dict | None = None,
        tx: object = None,
    ) -> None:
        options = options or {}
        source = sanitize_identifier(str(from_table), "from table")
        target = sanitize_identifier(str(to_table), "to table")
        if not self.table_exists(source, tx):
            if options.get("if_exists"):
                return
            raise ValueError(f'Table "{source}" does not exist.')
        if self.table_exists(target, tx):
            raise ValueError(f'Cannot rename table "{source}" to "{target}": target already exists.')
        self.connection.execute(f"ALTER TABLE {source} RENAME TO {target};", {})

    def remove_index(
        self,
        table: str,
        index_name: str,
        options: dict | None = None,
        tx: object = None,
    ) -> None:
        options = options or {}
        tname = sanitize_identifier(str(table), "table")
        iname = sanitize_identifier(str(index_name), "index")
        indexes = self.show_indexes(tname, tx)
        exists = any(idx.index_name == iname for idx in indexes)
        if not exists and options.get("if_exists"):
            return
        if not exists:
            raise ValueError(f'Index "{iname}" does not exist on table "{tname}".')
        self.connection.execute(f"DROP INDEX {iname};", {})

    def _restart_identity_columns(self, table: str, ignore_errors: bool) -> None:
        sql = """
            SELECT TRIM(rf.RDB$FIELD_NAME) AS CNAME
            FROM RDB$RELATION_FIELDS rf
            JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
            WHERE UPPER(TRIM(rf.RDB$RELATION_NAME)) = :table_name
              AND f.RDB$IDENTITY_TYPE IS NOT NULL
            ORDER BY rf.RDB$FIELD_POSITION
        """
        rows = self.connection.execute(sql, {"table_name": table})
        for row in rows:
            column = sanitize_identifier(str(row.get("CNAME") or row.get("cname")), "identity column")
            restart_sql = f"ALTER TABLE {table} ALTER COLUMN {column} RESTART WITH 1;"
            try:
                self.connection.execute(restart_sql, {})
            except Exception:
                if not ignore_errors:
                    raise


__all__ = ["QueryInterface", "find_matching_foreign_key"]
