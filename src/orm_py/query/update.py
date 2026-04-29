from __future__ import annotations

from typing import Any, Dict, Optional, Type

from sqlalchemy import select, update as sa_update
from ..operators import Op


def run_update(model_cls: Type[Any], values: dict[str, Any], options: Optional[Dict[str, Any]] = None) -> dict[str, Any]:
    options = options or {}
    model_cls._validate_payload(values, partial=True)
    where_filters = model_cls._build_filters(options.get("where"))
    session, owns_session = model_cls._session_from_options(options)
    try:
        pk_field = str(getattr(model_cls, "primaryKey", "ID"))
        pk_col = getattr(model_cls, pk_field)
        select_targets = select(pk_col).select_from(model_cls)
        target_ids = [
            row[0]
            for row in session.execute(select_targets.where(*where_filters)).all()
        ]
        if not target_ids:
            return {"count": 0, "rows": []}
        stmt = sa_update(model_cls).where(*where_filters).values(**values)
        result = session.execute(stmt)
        if owns_session:
            session.commit()
        else:
            session.flush()
        refreshed = list(
            session.execute(select(model_cls).where(pk_col.in_(target_ids))).scalars().all()
        )
        return model_cls._json_response({"count": int(result.rowcount or 0), "rows": refreshed})
    except Exception as exc:
        if owns_session:
            session.rollback()
        if model_cls._is_firebird_bind_cast_error(exc):
            if not target_ids:
                return {"count": 0, "rows": []}
            assignments = ", ".join(f"{k} = {model_cls._sql_literal(v)}" for k, v in values.items())
            in_values = ", ".join(model_cls._sql_literal(v) for v in target_ids)
            orm = model_cls._orm
            if orm is None:
                raise RuntimeError("Model has no orm bound.")
            orm.get_connection().execute(
                f"UPDATE {model_cls.tableName} SET {assignments} WHERE {pk_field} IN ({in_values})"
            )
            refreshed = model_cls.find_all({"where": {pk_field: {Op.in_: target_ids}}})
            return model_cls._json_response({"count": len(refreshed), "rows": refreshed})
        raise model_cls._wrap_model_error("update", exc) from exc
    finally:
        if owns_session:
            session.close()

