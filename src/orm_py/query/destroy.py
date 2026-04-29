from __future__ import annotations

from typing import Any, Dict, Optional, Type

from sqlalchemy import delete as sa_delete
from sqlalchemy import select


def run_destroy(model_cls: Type[Any], options: Optional[Dict[str, Any]] = None) -> dict[str, int]:
    options = options or {}
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
            return model_cls._json_response({"count": 0})
        stmt = sa_delete(model_cls).where(pk_col.in_(target_ids))
        result = session.execute(stmt)
        if owns_session:
            session.commit()
        else:
            session.flush()
        return model_cls._json_response({"count": int(result.rowcount or 0)})
    except Exception as exc:
        if owns_session:
            session.rollback()
        if model_cls._is_firebird_bind_cast_error(exc):
            orm = model_cls._orm
            if orm is None:
                raise RuntimeError("Model has no orm bound.")
            in_values = ", ".join(model_cls._sql_literal(v) for v in target_ids)
            orm.get_connection().execute(
                f"DELETE FROM {model_cls.tableName} WHERE {pk_field} IN ({in_values})"
            )
            return model_cls._json_response({"count": len(target_ids)})
        raise model_cls._wrap_model_error("destroy", exc) from exc
    finally:
        if owns_session:
            session.close()

