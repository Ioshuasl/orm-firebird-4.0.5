from __future__ import annotations

from typing import Any, Dict, Optional, Type

from sqlalchemy import func, select


def run_count(model_cls: Type[Any], options: Optional[Dict[str, Any]] = None) -> dict[str, int]:
    options = options or {}
    session, owns_session = model_cls._session_from_options(options)
    try:
        pk_name = str(getattr(model_cls, "primaryKey", "ID"))
        pk_col = getattr(model_cls, pk_name)
        stmt = select(func.count(func.distinct(pk_col))).select_from(model_cls)
        stmt = stmt.where(*model_cls._build_filters(options.get("where")))
        return model_cls._json_response({"count": int(session.execute(stmt).scalar_one())})
    finally:
        if owns_session:
            session.close()

