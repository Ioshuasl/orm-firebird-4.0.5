from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ReferentialAction = Literal["CASCADE", "RESTRICT", "NO ACTION", "SET NULL", "SET DEFAULT"] | str


@dataclass(slots=True)
class FirebirdForeignKeyInfo:
    constraint_name: str
    child_table: str
    child_field: str
    parent_table: str
    parent_field: str
    on_delete: ReferentialAction
    on_update: ReferentialAction
    segment_position: int


@dataclass(slots=True)
class ForeignKeyModelSpec:
    constraint_name: str
    child_table: str
    child_field: str
    parent_table: str
    parent_field: str
    on_delete: ReferentialAction | None = None
    on_update: ReferentialAction | None = None


@dataclass(slots=True)
class FirebirdColumnDescription:
    table_name: str
    column_name: str
    data_type: str
    nullable: bool
    default_value: str | None
    position: int
    length: int | None = None
    precision: int | None = None
    scale: int | None = None


@dataclass(slots=True)
class FirebirdConstraintInfo:
    constraint_name: str
    table_name: str
    type: str
    index_name: str | None = None
    referenced_constraint_name: str | None = None


@dataclass(slots=True)
class FirebirdIndexInfo:
    index_name: str
    table_name: str
    unique: bool
    index_type: str
    columns: list[str] = field(default_factory=list)


@dataclass(slots=True)
class SyncOptions:
    model_names: list[str] | None = None
    dry_run: bool = False
    force: bool = False
    fks_only: bool = False
    tables_only: bool = False
    transaction: Any = None
    logging: bool = False


@dataclass(slots=True)
class SyncResult:
    created_tables: list[str] = field(default_factory=list)
    created_foreign_keys: list[str] = field(default_factory=list)
    dropped_tables: list[str] = field(default_factory=list)
    skipped: dict[str, list[str]] = field(
        default_factory=lambda: {"existing_tables": [], "existing_foreign_keys": []}
    )
    sql: list[str] = field(default_factory=list)
