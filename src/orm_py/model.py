from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, ClassVar, Dict, Iterable, Optional, Type, TypeVar

from sqlalchemy import BIGINT, BOOLEAN, CHAR, DATE, DATETIME, FLOAT, INTEGER, NUMERIC, SMALLINT, TEXT, VARCHAR
from sqlalchemy import Column, Enum as SAEnum, ForeignKey, Table, text
from sqlalchemy import delete as sa_delete
from sqlalchemy import and_, func, or_, select, update as sa_update
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import UnmappedClassError
from sqlalchemy.orm.util import class_mapper

from .base import Base
from .associations import AssociationDefinition, find_association, register_association
from .data_types import BlobSubTypeBinary, BlobSubTypeText, DataType, DataTypeInput
from .errors import OriusORMError, ValidationError
from .operators import Op
from .operators import normalize_operator_key
from .sync import SyncOptions, SyncResult, sync_model_with_orm
from .query.hooks import HookHandler, add_model_hook, default_hooks_dict, run_model_hooks
from .validators import run_validate_entry
from .utils import (
    apply_order as apply_order_helper,
    infer_link_kind as infer_link_kind_helper,
    normalize_include as normalize_include_helper,
    normalize_include_list as normalize_include_list_helper,
    separate_eligible as separate_eligible_helper,
    split_join_includes_and_collect_separate_plans as split_join_helper,
    to_json_response,
)


ModelT = TypeVar("ModelT", bound="Model")


class Model(Base):
    """
    Sequelize-like model mixin for SQLAlchemy models.

    Expected usage:
      class Usuario(Model):
          __tablename__ = "G_USUARIO"
          ...
      orm.define(Usuario)
    """

    __abstract__ = True
    _orm: ClassVar[Any] = None
    modelName: ClassVar[Optional[str]] = None
    tableName: ClassVar[Optional[str]] = None
    primaryKey: ClassVar[str] = "ID"
    schema: ClassVar[Dict[str, Dict[str, Any]]] = {}
    modelOptions: ClassVar[Dict[str, Any]] = {}
    _hooks: ClassVar[Dict[str, list[HookHandler]]] = default_hooks_dict()

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        # Keep hooks isolated per model class (Sequelize-like behavior).
        cls._hooks = default_hooks_dict()

    def __init__(self, **kwargs: Any) -> None:
        schema = getattr(self.__class__, "schema", {}) or {}
        with_defaults = dict(kwargs)
        for key, column in schema.items():
            if with_defaults.get(key) is None and "defaultValue" in column:
                default = column.get("defaultValue")
                with_defaults[key] = default() if callable(default) else default
        super().__init__(**with_defaults)
        self._is_new_record = True
        self._previous_data_values = {k: v for k, v in with_defaults.items()}

    @classmethod
    def init(
        cls: Type[ModelT],
        attributes: Dict[str, Dict[str, Any]],
        options: Optional[Dict[str, Any]] = None,
    ) -> Type[ModelT]:
        """
        Sequelize-like Model.init(attributes, options).
        """
        options = options or {}
        orm = options.get("orm")
        options_without_orm = {k: v for k, v in options.items() if k != "orm"}

        cls.schema = cls._normalize_attributes(attributes)
        cls.tableName = str(options_without_orm.get("tableName") or cls.tableName or cls.__name__.upper())
        cls.modelName = str(options_without_orm.get("modelName") or cls.modelName or cls.__name__)
        cls.modelOptions = options_without_orm

        explicit_pk = options_without_orm.get("primaryKey")
        if explicit_pk:
            cls.primaryKey = str(explicit_pk)
        else:
            detected_pk = next((k for k, col in attributes.items() if bool(col.get("primaryKey"))), None)
            if detected_pk:
                cls.primaryKey = str(detected_pk)

        table = cls._build_table(cls.tableName, cls.schema)
        cls.__tablename__ = cls.tableName
        cls.__table__ = table
        cls.__mapper_args__ = {"primary_key": [table.c[cls.primaryKey]]} if cls.primaryKey in table.c else {}

        try:
            class_mapper(cls)
        except UnmappedClassError:
            Base.registry.map_imperatively(cls, table)

        if orm is not None:
            cls._orm = orm
            orm.register_model(cls)
        return cls

    @classmethod
    def _normalize_attributes(cls, attributes: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        normalized: Dict[str, Dict[str, Any]] = {}
        for name, column in attributes.items():
            cloned = dict(column)
            reference = cloned.get("references")
            if isinstance(reference, dict):
                model_ref = reference.get("model")
                if not isinstance(model_ref, str):
                    reference = dict(reference)
                    reference["model"] = (
                        getattr(model_ref, "modelName", None)
                        or getattr(model_ref, "tableName", None)
                        or getattr(model_ref, "__name__", None)
                        or str(model_ref)
                    )
                    cloned["references"] = reference
            normalized[name] = cloned
        return normalized

    @classmethod
    def _resolve_column_type(cls, raw_type: DataTypeInput) -> Any:
        if isinstance(raw_type, dict):
            key = str(raw_type.get("key", "")).upper()
            if key == "STRING":
                return VARCHAR(length=int(raw_type.get("length", 255)))
            if key == "CHAR":
                return CHAR(length=int(raw_type.get("length", 1)))
            if key == "INTEGER":
                return INTEGER()
            if key == "SMALLINT":
                return SMALLINT()
            if key == "BIGINT":
                return BIGINT()
            if key in ("NUMERIC", "DECIMAL"):
                return NUMERIC(
                    precision=int(raw_type.get("precision", 18)),
                    scale=int(raw_type.get("scale", 2 if key == "DECIMAL" else 0)),
                )
            if key in ("FLOAT", "DOUBLE"):
                return FLOAT()
            if key == "BOOLEAN":
                return BOOLEAN()
            if key in ("DATE", "DATEONLY"):
                return DATE()
            if key in ("TIME", "TIMESTAMP"):
                return DATETIME()
            if key in ("TEXT", "BLOB_TEXT"):
                return BlobSubTypeText()
            if key in ("BLOB",):
                return BlobSubTypeBinary()
            if key == "BINARY":
                return BlobSubTypeBinary()
            if key == "BLOB_BINARY":
                return BlobSubTypeBinary()
            if key == "ENUM":
                values = [str(v) for v in raw_type.get("values", [])]
                return SAEnum(*values, name=None, native_enum=False, create_constraint=False) if values else VARCHAR(length=255)
            return VARCHAR(length=255)

        key = str(raw_type.value if isinstance(raw_type, DataType) else raw_type or "").upper()
        if key == "VARCHAR":
            return VARCHAR(length=255)
        if key == "CHAR":
            return CHAR(length=1)
        if key == "INTEGER":
            return INTEGER()
        if key == "SMALLINT":
            return SMALLINT()
        if key == "BIGINT":
            return BIGINT()
        if key in ("NUMERIC", "DECIMAL"):
            return NUMERIC(18, 2)
        if key in ("FLOAT", "DOUBLE PRECISION"):
            return FLOAT()
        if key == "BOOLEAN":
            return BOOLEAN()
        if key == "DATE":
            return DATE()
        if key in ("TIME", "TIMESTAMP"):
            return DATETIME()
        if key in ("BLOB_TEXT", "TEXT"):
            return BlobSubTypeText()
        if key in ("BLOB_BIN", "BLOB SUB_TYPE BINARY", "BLOB"):
            return BlobSubTypeBinary()
        if key == "ENUM":
            return VARCHAR(length=255)
        return VARCHAR(length=255)

    @classmethod
    def _resolve_reference_target(cls, ref_model: str, ref_key: str) -> str:
        # Resolve by registered model name first, fallback to table-like value.
        orm = cls._orm
        if orm is not None:
            resolved = orm.models.get(ref_model) or orm.models.get(ref_model.upper())
            if resolved is not None:
                ref_table = (
                    getattr(resolved, "tableName", None)
                    or getattr(resolved, "__tablename__", None)
                    or ref_model
                )
                return f"{str(ref_table)}.{ref_key}"
        return f"{ref_model}.{ref_key}"

    @classmethod
    def _build_table(cls, table_name: str, attributes: Dict[str, Dict[str, Any]]) -> Table:
        columns = []
        for column_name, column_options in attributes.items():
            col_type = cls._resolve_column_type(column_options.get("type"))
            fk_args = []
            references = column_options.get("references")
            if isinstance(references, dict) and references.get("model") and references.get("key"):
                target = cls._resolve_reference_target(str(references["model"]), str(references["key"]))
                fk_args.append(
                    ForeignKey(
                        target,
                        onupdate=column_options.get("onUpdate"),
                        ondelete=column_options.get("onDelete"),
                        name=references.get("constraintName"),
                    )
                )
            server_default = None
            if column_options.get("sequence"):
                sequence_name = str(column_options.get("sequence"))
                server_default = text(f"NEXT VALUE FOR {sequence_name}")
            columns.append(
                Column(
                    column_name,
                    col_type,
                    *fk_args,
                    primary_key=bool(column_options.get("primaryKey", False)),
                    nullable=bool(column_options.get("allowNull", True)),
                    default=column_options.get("defaultValue"),
                    server_default=server_default,
                    quote=False,
                    autoincrement=bool(column_options.get("autoIncrement", False)),
                    unique=bool(column_options.get("unique", False)),
                    info={"sequence": column_options.get("sequence")},
                )
            )
        return Table(table_name, Base.metadata, *columns, extend_existing=True)

    @classmethod
    def sync(cls, options: Optional[SyncOptions] = None) -> SyncResult:
        orm = cls._orm
        if orm is None:
            raise RuntimeError("Model has no orm bound. Call orm.register_model(ModelClass) first.")
        return sync_model_with_orm(orm, cls, options)

    @classmethod
    def _session(cls) -> Session:
        orm = cls._orm
        if orm is None:
            raise RuntimeError("Model has no orm bound. Call orm.register_model(ModelClass) first.")
        return orm._session_factory()

    @classmethod
    def _session_from_options(cls, options: Optional[Dict[str, Any]] = None) -> tuple[Session, bool]:
        opts = options or {}
        tx = opts.get("transaction")
        if tx is None:
            return cls._session(), True
        if isinstance(tx, Session):
            return tx, False
        tx_session = getattr(tx, "session", None)
        if isinstance(tx_session, Session):
            return tx_session, False
        return cls._session(), True

    @classmethod
    def add_hook(cls, name: str, fn: HookHandler) -> None:
        add_model_hook(cls, name, fn)

    @classmethod
    def before_create(cls, fn: HookHandler) -> None:
        cls.add_hook("beforeCreate", fn)

    @classmethod
    def after_create(cls, fn: HookHandler) -> None:
        cls.add_hook("afterCreate", fn)

    @classmethod
    def before_update(cls, fn: HookHandler) -> None:
        cls.add_hook("beforeUpdate", fn)

    @classmethod
    def after_update(cls, fn: HookHandler) -> None:
        cls.add_hook("afterUpdate", fn)

    @classmethod
    def before_destroy(cls, fn: HookHandler) -> None:
        cls.add_hook("beforeDestroy", fn)

    @classmethod
    def after_destroy(cls, fn: HookHandler) -> None:
        cls.add_hook("afterDestroy", fn)

    @classmethod
    def before_save(cls, fn: HookHandler) -> None:
        cls.add_hook("beforeSave", fn)

    @classmethod
    def after_save(cls, fn: HookHandler) -> None:
        cls.add_hook("afterSave", fn)

    @classmethod
    def hasOne(cls, target: Type["Model"], options: Optional[Dict[str, Any]] = None) -> AssociationDefinition:
        return register_association("hasOne", cls, target, options)

    @classmethod
    def belongsTo(cls, target: Type["Model"], options: Optional[Dict[str, Any]] = None) -> AssociationDefinition:
        return register_association("belongsTo", cls, target, options)

    @classmethod
    def hasMany(cls, target: Type["Model"], options: Optional[Dict[str, Any]] = None) -> AssociationDefinition:
        return register_association("hasMany", cls, target, options)

    @classmethod
    def belongsToMany(cls, target: Type["Model"], options: Optional[Dict[str, Any]] = None) -> AssociationDefinition:
        return register_association("belongsToMany", cls, target, options)

    @classmethod
    def _run_hooks(cls, name: str, instance: "Model") -> None:
        run_model_hooks(cls, name, instance)

    @classmethod
    def _build_filters(cls, where: Optional[Dict[str, Any]]) -> list[Any]:
        expr = cls._build_where_expression(where, cls)
        return [expr] if expr is not None else []

    @classmethod
    def _build_operator_expression(cls, column: Any, operator: Any, value: Any) -> Any:
        op = normalize_operator_key(operator)
        symbol_map = {
            "=": "EQ",
            "==": "EQ",
            "<>": "NE",
            "!=": "NE",
            ">": "GT",
            ">=": "GTE",
            "<": "LT",
            "<=": "LTE",
            "NOT LIKE": "NOTLIKE",
            "NOT IN": "NOTIN",
            "NOT BETWEEN": "NOTBETWEEN",
        }
        op = symbol_map.get(op, op)
        if op == "IN":
            return column.in_(value)
        if op == "NOT IN":
            return ~column.in_(value)
        if op in ("<>", "!=", "NE"):
            return column.is_not(None) if value is None else column != value
        if op in (">", "GT"):
            return column > value
        if op in (">=", "GTE"):
            return column >= value
        if op in ("<", "LT"):
            return column < value
        if op in ("<=", "LTE"):
            return column <= value
        if op == "BETWEEN":
            return column.between(value[0], value[1])
        if op == "NOT BETWEEN":
            return ~column.between(value[0], value[1])
        if op == "LIKE":
            return column.like(value)
        if op == "ILIKE":
            return column.ilike(value)
        if op in ("IS",):
            return column.is_(value)
        if op in ("NOT",):
            return column.is_not(None) if value is None else column != value
        return column == value

    @classmethod
    def _build_column_expression(cls, model_ref: Any, column_name: str, value: Any) -> Any:
        column = getattr(model_ref, column_name)
        if value is None:
            return column.is_(None)
        if not isinstance(value, dict):
            return column == value

        clauses: list[Any] = []
        valid_ops = {
            "EQ",
            "NE",
            "GT",
            "GTE",
            "LT",
            "LTE",
            "LIKE",
            "NOTLIKE",
            "ILIKE",
            "IN",
            "NOTIN",
            "BETWEEN",
            "NOTBETWEEN",
            "IS",
            "NOT",
            "=",
            "==",
            "<>",
            "!=",
            ">",
            ">=",
            "<",
            "<=",
            "NOT LIKE",
            "NOT IN",
            "NOT BETWEEN",
        }
        for op, op_value in value.items():
            normalized = normalize_operator_key(op)
            if str(op).startswith("$") or normalized in valid_ops:
                clauses.append(cls._build_operator_expression(column, op, op_value))
                continue
            # Fallback for plain objects in where without operators.
            clauses.append(column == value)
            break
        return and_(*clauses) if len(clauses) > 1 else clauses[0]

    @classmethod
    def _build_where_expression(cls, where: Optional[Dict[str, Any]], model_ref: Any) -> Optional[Any]:
        if not where:
            return None

        clauses: list[Any] = []
        for key, value in where.items():
            logical = normalize_operator_key(key)
            if logical in ("AND", "OR"):
                items = value if isinstance(value, list) else [value]
                nested = [
                    cls._build_where_expression(item, model_ref)
                    for item in items
                    if isinstance(item, dict)
                ]
                nested = [entry for entry in nested if entry is not None]
                if nested:
                    clauses.append(and_(*nested) if logical == "AND" else or_(*nested))
                continue

            clauses.append(cls._build_column_expression(model_ref, str(key), value))

        if not clauses:
            return None
        return and_(*clauses) if len(clauses) > 1 else clauses[0]

    @classmethod
    def _normalize_include(cls, include: Any) -> list[Dict[str, Any]]:
        return normalize_include_helper(include)

    @classmethod
    def _normalize_include_list(cls, include: Any) -> list[Dict[str, Any]]:
        return normalize_include_list_helper(include)

    @classmethod
    def _infer_link_kind(cls, association: Optional[AssociationDefinition], include_item: Dict[str, Any]) -> str:
        return infer_link_kind_helper(association, include_item)

    @classmethod
    def _separate_eligible(cls, association: Optional[AssociationDefinition], include_item: Dict[str, Any]) -> bool:
        return separate_eligible_helper(association, include_item)

    @classmethod
    def _split_join_includes_and_collect_separate_plans(
        cls,
        includes: list[Dict[str, Any]],
        source_model: Any,
        path_to_source: list[str],
        separate_out: list[Dict[str, Any]],
    ) -> list[Dict[str, Any]]:
        return split_join_helper(includes, source_model, path_to_source, separate_out)

    @classmethod
    def _resolve_include_model(cls, source_model: Any, include_item: Any) -> Type["Model"]:
        if isinstance(include_item, type):
            return include_item
        association = find_association(
            source_model,
            association=include_item.get("association"),
            as_name=include_item.get("as"),
            model=include_item.get("model"),
        )
        if association is not None:
            include_item["_association"] = association
            return association.target
        model = include_item.get("model")
        if not isinstance(model, type):
            raise ValueError("include requires `model` (class).")
        return model

    @classmethod
    def _resolve_join_expression(cls, source_model: Any, target_model: Any, include_item: Dict[str, Any]) -> Any:
        association: Optional[AssociationDefinition] = include_item.get("_association")
        if association is not None:
            if association.type == "belongsTo":
                return getattr(source_model, association.foreign_key) == getattr(target_model, association.target_key)
            return getattr(source_model, association.source_key) == getattr(target_model, association.foreign_key)
        on_pair = include_item.get("on")
        if isinstance(on_pair, (list, tuple)) and len(on_pair) == 2:
            left_column = getattr(source_model, str(on_pair[0]))
            right_column = getattr(target_model, str(on_pair[1]))
            return left_column == right_column

        target_aliases = {
            str(getattr(target_model, "modelName", "")).upper(),
            str(getattr(target_model, "tableName", "")).upper(),
            str(getattr(target_model, "__name__", "")).upper(),
        }
        source_aliases = {
            str(getattr(source_model, "modelName", "")).upper(),
            str(getattr(source_model, "tableName", "")).upper(),
            str(getattr(source_model, "__name__", "")).upper(),
        }

        source_schema = getattr(source_model, "schema", {}) or {}
        for column_name, column_options in source_schema.items():
            ref = column_options.get("references")
            if isinstance(ref, dict):
                ref_model = str(ref.get("model", "")).upper()
                ref_key = str(ref.get("key", "ID"))
                if ref_model in target_aliases and hasattr(source_model, column_name) and hasattr(target_model, ref_key):
                    return getattr(source_model, column_name) == getattr(target_model, ref_key)

        target_schema = getattr(target_model, "schema", {}) or {}
        for column_name, column_options in target_schema.items():
            ref = column_options.get("references")
            if isinstance(ref, dict):
                ref_model = str(ref.get("model", "")).upper()
                ref_key = str(ref.get("key", "ID"))
                if ref_model in source_aliases and hasattr(target_model, column_name) and hasattr(source_model, ref_key):
                    return getattr(target_model, column_name) == getattr(source_model, ref_key)

        raise ValueError(
            f"Cannot infer join between {source_model.__name__} and {target_model.__name__}. "
            "Provide include.on = ['SOURCE_COL', 'TARGET_COL']."
        )

    @classmethod
    def _apply_includes(cls, stmt: Any, source_model: Any, include: Any) -> Any:
        include_items = cls._normalize_include(include)
        for raw_item in include_items:
            include_item: Dict[str, Any] = raw_item if isinstance(raw_item, dict) else {"model": raw_item}
            target_model = cls._resolve_include_model(source_model, include_item)
            join_expression = cls._resolve_join_expression(source_model, target_model, include_item)
            required = bool(include_item.get("required", False))
            stmt = stmt.join(target_model, join_expression, isouter=not required)

            include_where = cls._build_where_expression(include_item.get("where"), target_model)
            if include_where is not None:
                stmt = stmt.where(include_where)

            nested_include = include_item.get("include")
            if nested_include:
                stmt = cls._apply_includes(stmt, target_model, nested_include)
        return stmt

    @classmethod
    def _apply_include_projection(
        cls,
        stmt: Any,
        source_model: Any,
        include: Any,
        path: Optional[list[str]] = None,
        meta: Optional[list[Dict[str, Any]]] = None,
    ) -> tuple[Any, list[Dict[str, Any]]]:
        path = path or []
        meta = meta or []
        include_items = cls._normalize_include_list(include)
        for raw_item in include_items:
            include_item: Dict[str, Any] = raw_item
            target_model = cls._resolve_include_model(source_model, include_item)
            association: Optional[AssociationDefinition] = include_item.get("_association")
            alias_name = str(include_item.get("as") or (association.as_name if association else target_model.__name__.lower()))
            current_path = [*path, alias_name]
            join_expression = cls._resolve_join_expression(source_model, target_model, include_item)
            required = bool(include_item.get("required", False))
            stmt = stmt.join(target_model, join_expression, isouter=not required)
            include_where = cls._build_where_expression(include_item.get("where"), target_model)
            if include_where is not None:
                stmt = stmt.where(include_where)

            target_attrs = include_item.get("attributes")
            if not target_attrs:
                target_attrs = list((getattr(target_model, "schema", {}) or {}).keys()) or [c.name for c in target_model.__table__.columns]
            for attr in target_attrs:
                stmt = stmt.add_columns(getattr(target_model, attr).label(f"{'__'.join(current_path)}__{attr}"))
            meta.append(
                {
                    "path": current_path,
                    "attrs": target_attrs,
                    "type": "many" if association and association.type in ("hasMany", "belongsToMany") else "single",
                    "dedupe_by": association.target_key if association else getattr(target_model, "primaryKey", "ID"),
                }
            )

            nested_include = include_item.get("include")
            if nested_include:
                stmt, meta = cls._apply_include_projection(stmt, target_model, nested_include, current_path, meta)
        return stmt, meta

    @classmethod
    def _assign_path_value(
        cls,
        target: Dict[str, Any],
        path: list[str],
        value: Any,
        relation_type: str,
        dedupe_by: Optional[str] = None,
    ) -> None:
        cursor: Any = target
        for key in path[:-1]:
            if key not in cursor or not isinstance(cursor[key], dict):
                cursor[key] = {}
            cursor = cursor[key]
        leaf = path[-1]
        if relation_type == "many":
            if leaf not in cursor or not isinstance(cursor[leaf], list):
                cursor[leaf] = []
            if value is None:
                return
            if dedupe_by and any(str(entry.get(dedupe_by)) == str(value.get(dedupe_by)) for entry in cursor[leaf]):
                return
            cursor[leaf].append(value)
            return
        cursor[leaf] = value

    @classmethod
    def _materialize_include_rows(
        cls: Type[ModelT],
        rows: list[Dict[str, Any]],
        base_attrs: list[str],
        include_meta: list[Dict[str, Any]],
    ) -> list[Dict[str, Any]]:
        pk_field = str(getattr(cls, "primaryKey", "ID"))
        grouped: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            key = str(row.get(pk_field))
            parent = grouped.get(key)
            if parent is None:
                parent = {attr: row.get(attr) for attr in base_attrs}
                grouped[key] = parent
            for meta in include_meta:
                prefix = f"{'__'.join(meta['path'])}__"
                child = {attr: row.get(f"{prefix}{attr}") for attr in meta["attrs"]}
                has_values = any(value is not None for value in child.values())
                cls._assign_path_value(
                    parent,
                    meta["path"],
                    child if has_values else None,
                    meta["type"],
                    meta.get("dedupe_by"),
                )

        return list(grouped.values())

    @classmethod
    def _to_instances(cls: Type[ModelT], payloads: list[Dict[str, Any]], base_attrs: list[str]) -> list[ModelT]:
        results: list[ModelT] = []
        for payload in payloads:
            instance = cls(**{k: payload.get(k) for k in base_attrs if k in cls.schema})
            for key, value in payload.items():
                if key not in cls.schema:
                    setattr(instance, key, value)
            results.append(instance)
        return results

    @classmethod
    def _get_value(cls, obj: Any, key: str) -> Any:
        if obj is None:
            return None
        if isinstance(obj, dict):
            return obj.get(key)
        return getattr(obj, key, None)

    @classmethod
    def _get_anchor_objects(cls, rows: list[Dict[str, Any]], path_to_source: list[str]) -> list[Dict[str, Any]]:
        if not path_to_source:
            return [r for r in rows if isinstance(r, dict)]
        acc: list[Any] = [r for r in rows if isinstance(r, dict)]
        for key in path_to_source:
            nxt: list[Any] = []
            for item in acc:
                val = cls._get_value(item, key)
                if val is None:
                    continue
                if isinstance(val, list):
                    nxt.extend([x for x in val if x is not None])
                else:
                    nxt.append(val)
            acc = nxt
        return [x for x in acc if isinstance(x, dict)]

    @classmethod
    def _apply_separate_fetches(
        cls,
        rows: list[Dict[str, Any]],
        plans: list[Dict[str, Any]],
        base_options: Dict[str, Any],
    ) -> None:
        if not rows or not plans:
            return
        sorted_plans = sorted(plans, key=lambda p: len(p["pathToSource"]))
        for plan in sorted_plans:
            node = plan["node"]
            target_model = plan["targetModel"]
            association: Optional[AssociationDefinition] = plan.get("association")
            anchors = cls._get_anchor_objects(rows, plan["pathToSource"])
            if not anchors:
                continue

            # build key plan
            if association is not None and association.type == "belongsTo":
                keys = [cls._get_value(a, association.foreign_key) for a in anchors]
                filter_column = association.target_key
                source_key = association.foreign_key
                link_kind = "belongsTo"
            elif association is not None and association.type in ("hasMany", "hasOne"):
                keys = [cls._get_value(a, association.source_key) for a in anchors]
                filter_column = association.foreign_key
                source_key = association.source_key
                link_kind = association.type
            else:
                on_pair = node.get("on")
                if not on_pair or len(on_pair) != 2:
                    continue
                keys = [cls._get_value(a, str(on_pair[0])) for a in anchors]
                filter_column = str(on_pair[1])
                source_key = str(on_pair[0])
                link_kind = str(plan.get("linkKind", "hasMany"))

            unique_keys = []
            seen = set()
            for key in keys:
                if key is None:
                    continue
                sk = str(key)
                if sk in seen:
                    continue
                seen.add(sk)
                unique_keys.append(key)

            if not unique_keys:
                for anchor in anchors:
                    anchor[plan["as"]] = [] if link_kind == "hasMany" else None
                continue

            child_where = {filter_column: {Op.in_: unique_keys}}
            if isinstance(node.get("where"), dict):
                child_where.update(node["where"])
            child_options: Dict[str, Any] = {
                "where": child_where,
                "include": node.get("include"),
                "attributes": node.get("attributes"),
                "order": node.get("order"),
                "limit": node.get("limit"),
                "offset": node.get("offset"),
            }
            for passthrough in ("transaction", "logging", "benchmark"):
                if passthrough in base_options:
                    child_options[passthrough] = base_options[passthrough]

            children = target_model.find_all(child_options)
            child_payloads = [dict(vars(c)) for c in children]

            if link_kind == "hasMany":
                grouped: Dict[str, list[Dict[str, Any]]] = {}
                fk = filter_column
                for child in child_payloads:
                    fk_val = child.get(fk)
                    key = str(fk_val)
                    grouped.setdefault(key, []).append(child)
                for anchor in anchors:
                    source_val = cls._get_value(anchor, source_key)
                    anchor[plan["as"]] = grouped.get(str(source_val), [])
            elif link_kind == "hasOne":
                grouped_one: Dict[str, Dict[str, Any]] = {}
                fk = filter_column
                for child in child_payloads:
                    key = str(child.get(fk))
                    if key not in grouped_one:
                        grouped_one[key] = child
                for anchor in anchors:
                    source_val = cls._get_value(anchor, source_key)
                    anchor[plan["as"]] = grouped_one.get(str(source_val))
            else:
                grouped_single: Dict[str, Dict[str, Any]] = {}
                for child in child_payloads:
                    grouped_single[str(child.get(filter_column))] = child
                for anchor in anchors:
                    source_val = cls._get_value(anchor, source_key)
                    anchor[plan["as"]] = grouped_single.get(str(source_val))

    @classmethod
    def _is_firebird_bind_cast_error(cls, exc: Exception) -> bool:
        message = str(exc)
        return "unsupported operand type(s) for +" in message and ("'int' and 'str'" in message or "'NoneType' and 'str'" in message)

    @classmethod
    def _friendly_hint_for_exception(cls, exc: Exception) -> str:
        if isinstance(exc, ValidationError):
            return "Ajuste os campos do payload conforme as regras validate/allowNull/ENUM."
        msg = str(exc).lower()
        if "foreign key" in msg:
            return "A chave estrangeira informada nao existe na tabela de referencia."
        if "unique" in msg or "duplicate" in msg:
            return "Ja existe registro com a mesma chave/valor unico."
        if "unsupported operand type" in msg:
            return "Tipos incompativeis detectados pelo dialect Firebird; alinhe NUMERIC/VARCHAR ao schema real."
        return "Revise payload, tipos de dados e filtros where/include."

    @classmethod
    def _wrap_model_error(cls, operation: str, exc: Exception) -> OriusORMError:
        return OriusORMError(
            operation=operation,
            model=str(getattr(cls, "modelName", None) or cls.__name__),
            message=str(exc),
            hint=cls._friendly_hint_for_exception(exc),
            original_error=exc,
        )

    @classmethod
    def _sql_literal(cls, value: Any) -> str:
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "1" if value else "0"
        if isinstance(value, (int, float, Decimal)):
            return str(value)
        if isinstance(value, datetime):
            return f"'{value.strftime('%Y-%m-%d %H:%M:%S')}'"
        raw = str(value).replace("'", "''")
        return f"'{raw}'"

    @classmethod
    def _raw_insert_and_fetch(cls: Type[ModelT], values: Dict[str, Any]) -> ModelT:
        orm = cls._orm
        if orm is None:
            raise RuntimeError("Model has no orm bound.")
        columns = [k for k, v in values.items() if v is not None]
        if not columns:
            raise ValueError("create() values cannot be empty.")
        sql = (
            f"INSERT INTO {cls.tableName} ({', '.join(columns)}) VALUES ("
            + ", ".join(cls._sql_literal(values[c]) for c in columns)
            + ")"
        )
        orm.get_connection().execute(sql)
        pk_field = str(getattr(cls, "primaryKey", "ID"))
        inserted = cls.find_one({"where": {pk_field: values.get(pk_field)}})
        if inserted is None:
            return cls(**values)
        return inserted

    @classmethod
    def _apply_order(cls, stmt: Any, order: Optional[list[tuple[str, str]]]) -> Any:
        return apply_order_helper(cls, stmt, order)

    @classmethod
    def _json_response(cls, value: Any) -> Any:
        return to_json_response(value)

    @classmethod
    def _resolve_enum_values(cls, raw_type: Any) -> list[Any] | None:
        if isinstance(raw_type, dict) and str(raw_type.get("key", "")).upper() == "ENUM":
            values = raw_type.get("values") or []
            return list(values)
        return None

    @classmethod
    def _validate_payload(cls, payload: Dict[str, Any], *, partial: bool = False) -> None:
        schema = cls.schema or {}
        errors: list[str] = []

        for key, column in schema.items():
            has_value = key in payload
            value = payload.get(key)
            allow_null = bool(column.get("allowNull", True))

            if not partial or has_value:
                if (value is None) and not allow_null:
                    errors.append(f"{key} cannot be null.")
                    continue

            if has_value and value is None and "defaultValue" in column:
                default = column.get("defaultValue")
                payload[key] = default() if callable(default) else default
                value = payload[key]

            enum_values = cls._resolve_enum_values(column.get("type"))
            if enum_values and value is not None and value not in enum_values:
                errors.append(f"{key} must be one of: {', '.join(str(v) for v in enum_values)}")

            validator_spec = column.get("validate")
            if validator_spec is None:
                continue
            if partial and not has_value:
                continue

            if callable(validator_spec):
                result = validator_spec(value)
                if result is False:
                    errors.append(f"{key} failed validation.")
                elif isinstance(result, str) and result:
                    errors.append(result)
                continue

            if isinstance(validator_spec, dict):
                for validator_name, spec in validator_spec.items():
                    result = run_validate_entry(key, str(validator_name), spec, value, column)
                    if result is False:
                        errors.append(f'{key} failed "{validator_name}" validation.')
                    elif isinstance(result, str) and result:
                        errors.append(result)
                continue

            errors.append(f"{key}: invalid validate config.")

        if errors:
            raise ValidationError("Validation error", errors)

    def validate(self) -> None:
        payload = {k: v for k, v in vars(self).items() if not k.startswith("_")}
        self.__class__._validate_payload(payload, partial=False)

    @classmethod
    def create(cls: Type[ModelT], values: dict[str, Any], options: Optional[Dict[str, Any]] = None) -> dict[str, Any]:
        from .query.create import run_create

        return run_create(cls, values, options)

    @classmethod
    def find_all(
        cls: Type[ModelT],
        options: Optional[Dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        from .query.findAll import run_find_all

        return run_find_all(cls, options)

    @classmethod
    def find_one(cls: Type[ModelT], options: Optional[Dict[str, Any]] = None) -> Optional[dict[str, Any]]:
        from .query.findOne import run_find_one

        return run_find_one(cls, options)

    @classmethod
    def find_by_pk(cls: Type[ModelT], identifier: Any, options: Optional[Dict[str, Any]] = None) -> Optional[dict[str, Any]]:
        from .query.findByPk import run_find_by_pk

        return run_find_by_pk(cls, identifier, options)

    @classmethod
    def count(cls, options: Optional[Dict[str, Any]] = None) -> dict[str, int]:
        from .query.count import run_count

        return run_count(cls, options)

    @classmethod
    def find_and_count_all(
        cls: Type[ModelT],
        options: Optional[Dict[str, Any]] = None,
    ) -> dict[str, Any]:
        from .query.findAndCountAll import run_find_and_count_all

        return run_find_and_count_all(cls, options)

    @classmethod
    def update(
        cls,
        values: dict[str, Any],
        options: Optional[Dict[str, Any]] = None,
    ) -> dict[str, Any]:
        from .query.update import run_update

        return run_update(cls, values, options)

    @classmethod
    def destroy(cls, options: Optional[Dict[str, Any]] = None) -> dict[str, int]:
        from .query.destroy import run_destroy

        return run_destroy(cls, options)

    def save(self: ModelT, options: Optional[Dict[str, Any]] = None) -> dict[str, Any]:
        from .query.save import run_save

        return run_save(self, options)

    def is_new_record(self) -> bool:
        from .query.isNewRecord import run_is_new_record

        return run_is_new_record(self)

    def changed(self, key: Optional[str] = None) -> Any:
        from .query.changed import run_changed

        return run_changed(self, key)

    def previous(self, key: Optional[str] = None) -> Any:
        from .query.previous import run_previous

        return run_previous(self, key)

    def get(self, key: str) -> Any:
        from .query.get import run_get

        return run_get(self, key)

    def set(self, key: Any, value: Any = None) -> "Model":
        from .query.set import run_set

        return run_set(self, key, value)

    def reload(self: ModelT) -> dict[str, Any]:
        session = self.__class__._session()
        try:
            attached = session.merge(self)
            session.refresh(attached)
            return self.__class__._json_response(attached)
        except NoResultFound:
            raise self.__class__._wrap_model_error(
                "reload",
                RuntimeError("Cannot reload instance: row no longer exists."),
            )
        except Exception as exc:
            raise self.__class__._wrap_model_error("reload", exc) from exc
        finally:
            session.close()

    def destroy_instance(self) -> dict[str, int]:
        self.__class__._run_hooks("before_destroy", self)
        session = self.__class__._session()
        try:
            attached = session.merge(self)
            session.delete(attached)
            session.commit()
            self.__class__._run_hooks("after_destroy", self)
            return self.__class__._json_response({"count": 1})
        except Exception as exc:
            session.rollback()
            raise self.__class__._wrap_model_error("destroy_instance", exc) from exc
        finally:
            session.close()

    # Sequelize-like aliases (camelCase)
    findAll = find_all
    findOne = find_one
    findByPk = find_by_pk
    findAndCountAll = find_and_count_all
    isNewRecord = is_new_record
    beforeCreate = before_create
    afterCreate = after_create
    beforeUpdate = before_update
    afterUpdate = after_update
    beforeSave = before_save
    afterSave = after_save
    beforeDestroy = before_destroy
    afterDestroy = after_destroy
