from __future__ import annotations

from typing import Any, Dict, Optional, Type


def run_create(model_cls: Type[Any], values: dict[str, Any], options: Optional[Dict[str, Any]] = None) -> dict[str, Any]:
    options = options or {}
    instance = model_cls(**values)
    instance.validate()
    model_cls._run_hooks("before_create", instance)
    model_cls._run_hooks("before_save", instance)
    session, owns_session = model_cls._session_from_options(options)
    try:
        session.add(instance)
        if owns_session:
            session.commit()
        else:
            session.flush()
        session.refresh(instance)
        model_cls._run_hooks("after_create", instance)
        model_cls._run_hooks("after_save", instance)
        return model_cls._json_response(instance)
    except Exception as exc:
        if owns_session:
            session.rollback()
        if model_cls._is_firebird_bind_cast_error(exc):
            return model_cls._json_response(model_cls._raw_insert_and_fetch(values))
        raise model_cls._wrap_model_error("create", exc) from exc
    finally:
        if owns_session:
            session.close()

