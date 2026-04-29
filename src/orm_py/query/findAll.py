from __future__ import annotations

from typing import Any, Dict, Optional, Type

from sqlalchemy import select
from ..utils.query_helpers import (
    apply_order,
    normalize_include_list,
    split_join_includes_and_collect_separate_plans,
)


def run_find_all(model_cls: Type[Any], options: Optional[Dict[str, Any]] = None) -> list[dict[str, Any]]:
    options = options or {}
    session, owns_session = model_cls._session_from_options(options)
    try:
        include = options.get("include")
        if include:
            include_list = normalize_include_list(include)
            separate_plans: list[Dict[str, Any]] = []
            join_only = split_join_includes_and_collect_separate_plans(include_list, model_cls, [], separate_plans)
            attrs = options.get("attributes")
            base_attrs = list(attrs) if attrs else list((model_cls.schema or {}).keys())
            if not base_attrs:
                base_attrs = [c.name for c in model_cls.__table__.columns]
            pk_field = str(getattr(model_cls, "primaryKey", "ID"))
            if pk_field not in base_attrs:
                base_attrs.append(pk_field)
            stmt = select(*(getattr(model_cls, attr).label(attr) for attr in base_attrs))
            stmt, include_meta = model_cls._apply_include_projection(stmt, model_cls, join_only)
            stmt = stmt.where(*model_cls._build_filters(options.get("where")))
            stmt = apply_order(model_cls, stmt, options.get("order"))
            if options.get("offset") is not None:
                stmt = stmt.offset(int(options["offset"]))
            if options.get("limit") is not None:
                stmt = stmt.limit(int(options["limit"]))
            rows = [dict(r) for r in session.execute(stmt).mappings().all()]
            payloads = model_cls._materialize_include_rows(rows, base_attrs, include_meta)
            if separate_plans:
                model_cls._apply_separate_fetches(payloads, separate_plans, options)
            return model_cls._json_response(model_cls._to_instances(payloads, base_attrs))

        stmt = select(model_cls)
        stmt = stmt.where(*model_cls._build_filters(options.get("where")))
        stmt = apply_order(model_cls, stmt, options.get("order"))
        attrs = options.get("attributes")
        if attrs:
            stmt = select(*(getattr(model_cls, attr) for attr in attrs))
            stmt = stmt.where(*model_cls._build_filters(options.get("where")))
            stmt = apply_order(model_cls, stmt, options.get("order"))
            if options.get("offset") is not None:
                stmt = stmt.offset(int(options["offset"]))
            if options.get("limit") is not None:
                stmt = stmt.limit(int(options["limit"]))
            rows = session.execute(stmt).mappings().all()
            return model_cls._json_response([model_cls(**dict(row)) for row in rows])
        if options.get("offset") is not None:
            stmt = stmt.offset(int(options["offset"]))
        if options.get("limit") is not None:
            stmt = stmt.limit(int(options["limit"]))
        return model_cls._json_response(list(session.execute(stmt).unique().scalars().all()))
    except Exception as exc:
        raise model_cls._wrap_model_error("findAll", exc) from exc
    finally:
        if owns_session:
            session.close()

