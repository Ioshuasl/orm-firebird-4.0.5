from __future__ import annotations

from ..associations import get_associations
from .column_ddl import (
    build_create_table_ddl,
    build_foreign_key_constraint_ddl,
    get_foreign_key_spec,
    spec_key,
)
from .introspect import find_matching_foreign_key
from .query_interface import QueryInterface
from .types import FirebirdForeignKeyInfo, SyncOptions, SyncResult


def collect_unique_models(orm, filter_names: list[str] | None = None) -> list[type]:
    seen_tables: set[str] = set()
    out: list[type] = []
    for model in orm.models.values():
        if not isinstance(model, type):
            continue
        table = str(getattr(model, "tableName", getattr(model, "__tablename__", ""))).upper()
        if not table or table in seen_tables:
            continue
        if filter_names:
            model_name = str(getattr(model, "modelName", model.__name__))
            accepted = any(
                f.upper() == table or f == model_name or f.upper() == model_name.upper() for f in filter_names
            )
            if not accepted:
                continue
        seen_tables.add(table)
        out.append(model)
    return out


def merge_junction_from_belongs_to_many(orm, model_list: list[type]) -> list[type]:
    seen_tables = {str(getattr(m, "tableName", getattr(m, "__tablename__", ""))).upper() for m in model_list}
    extra: list[type] = []
    for model in model_list:
        for assoc in get_associations(model):
            if assoc.type != "belongsToMany" or assoc.through is None:
                continue
            table = str(getattr(assoc.through, "tableName", getattr(assoc.through, "__tablename__", ""))).upper()
            if not table or table in seen_tables:
                continue
            if not any(v is assoc.through for v in orm.models.values()):
                continue
            seen_tables.add(table)
            extra.append(assoc.through)
    return model_list + extra


def topological_sort_for_sync(models: list[type], orm) -> list[type]:
    table_to_model = {
        str(getattr(m, "tableName", getattr(m, "__tablename__", ""))).upper(): m for m in models
    }
    nodes = set(table_to_model.keys())
    adj: dict[str, set[str]] = {}
    indegree: dict[str, int] = {n: 0 for n in nodes}

    for model in models:
        child = str(getattr(model, "tableName", getattr(model, "__tablename__", ""))).upper()
        schema = dict(getattr(model, "schema", {}) or {})
        for col_name, col in schema.items():
            spec = get_foreign_key_spec(child, col_name, col, orm)
            if spec is None:
                continue
            parent = spec.parent_table.upper()
            if parent not in nodes:
                continue
            adj.setdefault(parent, set())
            if child not in adj[parent]:
                adj[parent].add(child)
                indegree[child] = indegree.get(child, 0) + 1

    queue = sorted([n for n, d in indegree.items() if d == 0])
    order: list[str] = []
    while queue:
        current = queue.pop(0)
        order.append(current)
        for nxt in adj.get(current, set()):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
                queue.sort()

    if len(order) != len(nodes):
        raise RuntimeError("FK cycle detected between models. Adjust references or sync in phases.")
    return [table_to_model[t] for t in order if t in table_to_model]


def sync_orius_orm(orm, options: SyncOptions | None = None) -> SyncResult:
    options = options or SyncOptions()
    qi = QueryInterface(orm.get_connection())
    result = SyncResult()

    base_models = collect_unique_models(orm, options.model_names)
    models = merge_junction_from_belongs_to_many(orm, base_models)
    if not models:
        return result

    create_order = topological_sort_for_sync(models, orm)
    drop_order = list(reversed(create_order))
    dry = bool(options.dry_run)

    def run_sql(sql: str) -> None:
        result.sql.append(sql)
        if not dry:
            orm.get_connection().execute(sql, {})

    if options.force and not options.fks_only:
        for model in drop_order:
            table = str(getattr(model, "tableName", getattr(model, "__tablename__", "")))
            table_u = table.upper()
            if dry:
                if qi.table_exists(table):
                    result.sql.append(f"DROP TABLE {table_u};")
            else:
                if qi.table_exists(table):
                    qi.drop_table(table)
                    result.dropped_tables.append(table_u)

    existing_fks = qi.list_foreign_keys()

    if not options.fks_only:
        for model in create_order:
            table = str(getattr(model, "tableName", getattr(model, "__tablename__", "")))
            schema = dict(getattr(model, "schema", {}) or {})
            attr_keys = list(schema.keys())
            if qi.table_exists(table):
                result.skipped["existing_tables"].append(table.upper())
                continue
            create_sql = build_create_table_ddl(table, attr_keys, schema, {"use_identity": True}) + ";"
            run_sql(create_sql)
            result.created_tables.append(table.upper())

    if options.tables_only:
        return result

    existing_fks = qi.list_foreign_keys()
    for model in create_order:
        child_table = str(getattr(model, "tableName", getattr(model, "__tablename__", "")))
        schema = dict(getattr(model, "schema", {}) or {})
        for col_name, col in schema.items():
            if not isinstance(col, dict) or "references" not in col:
                continue
            spec = get_foreign_key_spec(child_table, col_name, col, orm)
            if spec is None:
                continue
            matched = find_matching_foreign_key(
                existing_fks,
                {
                    "child_table": spec.child_table,
                    "child_field": spec.child_field,
                    "parent_table": spec.parent_table,
                    "parent_field": spec.parent_field,
                },
            )
            if matched is not None:
                result.skipped["existing_foreign_keys"].append(spec_key(spec))
                continue
            fk_sql = build_foreign_key_constraint_ddl(spec.child_table, [spec]) + ";"
            run_sql(fk_sql)
            result.created_foreign_keys.append(spec.constraint_name)
            if dry:
                existing_fks = [
                    *existing_fks,
                    FirebirdForeignKeyInfo(
                        constraint_name=spec.constraint_name,
                        child_table=spec.child_table,
                        child_field=spec.child_field,
                        parent_table=spec.parent_table,
                        parent_field=spec.parent_field,
                        on_delete="NO ACTION",
                        on_update="NO ACTION",
                        segment_position=0,
                    ),
                ]
            else:
                existing_fks = qi.list_foreign_keys()

    return result


def sync_model_with_orm(orm, model_class, options: SyncOptions | None = None) -> SyncResult:
    options = options or SyncOptions()
    name = getattr(model_class, "modelName", model_class.__name__)
    table = getattr(model_class, "tableName", getattr(model_class, "__tablename__", None))
    names = [v for v in [name, table] if v]
    merged_names = list({*(options.model_names or []), *names})
    local_options = SyncOptions(
        model_names=merged_names,
        dry_run=options.dry_run,
        force=options.force,
        fks_only=options.fks_only,
        tables_only=options.tables_only,
        transaction=options.transaction,
        logging=options.logging,
    )
    return sync_orius_orm(orm, local_options)
