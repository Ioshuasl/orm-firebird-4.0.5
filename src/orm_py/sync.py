from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import inspect
from sqlalchemy.schema import CreateTable

if TYPE_CHECKING:
    from .base import OriusORM


@dataclass(slots=True)
class SyncOptions:
    model_names: Optional[List[str]] = None
    dry_run: bool = False
    force: bool = False
    tables_only: bool = False  # kept for API parity; SQLAlchemy create_all already creates FK DDL
    fks_only: bool = False  # kept for API parity; no-op in this first Python version


@dataclass(slots=True)
class SyncResult:
    created_tables: List[str] = field(default_factory=list)
    dropped_tables: List[str] = field(default_factory=list)
    skipped_existing_tables: List[str] = field(default_factory=list)
    sql: List[str] = field(default_factory=list)


def sync_orius_orm(orm: "OriusORM", options: SyncOptions) -> SyncResult:
    engine = orm.get_connection().get_engine()
    inspector = inspect(engine)
    result = SyncResult()

    models = _collect_models(orm, options.model_names)
    if not models:
        return result

    target_tables = [m.__table__ for m in models]

    if options.dry_run:
        for table in target_tables:
            result.sql.append(str(CreateTable(table).compile(engine)).strip() + ";")
        if options.force:
            for table in reversed(target_tables):
                result.sql.insert(0, f'DROP TABLE {table.name.upper()};')
        return result

    if options.force:
        for table in reversed(target_tables):
            if inspector.has_table(table.name):
                table.drop(bind=engine, checkfirst=True)
                result.dropped_tables.append(table.name.upper())

    if options.fks_only:
        # SQLAlchemy does not expose a simple "only missing FKs" workflow across dialects.
        # We keep API parity and return without table creation.
        return result

    for table in target_tables:
        if inspector.has_table(table.name):
            result.skipped_existing_tables.append(table.name.upper())
            continue
        table.create(bind=engine, checkfirst=True)
        result.created_tables.append(table.name.upper())
        if options.tables_only:
            # create table already includes columns; relations are declared by SQLAlchemy metadata.
            continue

    # Keep parity fields in result.sql for diagnostics.
    result.sql.extend([str(CreateTable(table).compile(engine)).strip() + ";" for table in target_tables])
    return result


def sync_model_with_orm(orm: "OriusORM", model_class: type, options: Optional[SyncOptions] = None) -> SyncResult:
    resolved_options = options or SyncOptions()
    names = [model_class.__name__, getattr(model_class, "__tablename__", model_class.__name__)]
    resolved_options.model_names = [*set([*(resolved_options.model_names or []), *names])]
    return sync_orius_orm(orm, resolved_options)


def _collect_models(orm: "OriusORM", model_names: Optional[List[str]]) -> List[type]:
    by_table = {}
    for model in orm.models.values():
        table_name = getattr(model, "__tablename__", "").upper()
        if not table_name or table_name in by_table:
            continue
        by_table[table_name] = model

    models = list(by_table.values())
    if not model_names:
        return models

    accepted = {name.upper() for name in model_names}
    out = []
    for model in models:
        if model.__name__.upper() in accepted or getattr(model, "__tablename__", "").upper() in accepted:
            out.append(model)
    return out
