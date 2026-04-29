from __future__ import annotations

from typing import Any, Dict, Optional


def _instance_payload(instance: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    for key, value in vars(instance).items():
        if key.startswith("_"):
            continue
        payload[key] = value
    return payload


def run_save(instance: Any, options: Optional[Dict[str, Any]] = None) -> dict[str, Any]:
    model_cls = instance.__class__
    options = options or {}
    is_new = bool(getattr(instance, "_is_new_record", False))
    model_cls._run_hooks("before_save", instance)
    model_cls._run_hooks("before_create" if is_new else "before_update", instance)
    instance.validate()
    session, owns_session = model_cls._session_from_options(options)
    try:
        merged = session.merge(instance)
        if owns_session:
            session.commit()
        else:
            session.flush()
        session.refresh(merged)
        model_cls._run_hooks("after_create" if is_new else "after_update", merged)
        model_cls._run_hooks("after_save", merged)
        payload = dict(vars(merged))
        instance._previous_data_values = {k: v for k, v in payload.items() if not k.startswith("_")}
        instance._is_new_record = False
        return model_cls._json_response(merged)
    except Exception as exc:
        if owns_session:
            session.rollback()
        if model_cls._is_firebird_bind_cast_error(exc):
            payload = _instance_payload(instance)
            pk_field = str(getattr(model_cls, "primaryKey", "ID"))
            pk_value = payload.get(pk_field)
            if pk_value is None:
                raise model_cls._wrap_model_error("save", RuntimeError("Primary key is required for save fallback."))

            existing = model_cls.find_by_pk(pk_value)
            if existing:
                update_values = {k: v for k, v in payload.items() if k != pk_field}
                if update_values:
                    assignments = ", ".join(f"{k} = {model_cls._sql_literal(v)}" for k, v in update_values.items())
                    orm = model_cls._orm
                    if orm is None:
                        raise RuntimeError("Model has no orm bound.")
                    orm.get_connection().execute(
                        f"UPDATE {model_cls.tableName} SET {assignments} WHERE {pk_field} = {model_cls._sql_literal(pk_value)}"
                    )
                refreshed = model_cls.find_by_pk(pk_value)
                model_cls._run_hooks("after_update", instance)
                model_cls._run_hooks("after_save", instance)
                return model_cls._json_response(refreshed)

            inserted = model_cls._raw_insert_and_fetch(payload)
            model_cls._run_hooks("after_create", instance)
            model_cls._run_hooks("after_save", instance)
            current = dict(vars(instance))
            instance._previous_data_values = {k: v for k, v in current.items() if not k.startswith("_")}
            instance._is_new_record = False
            return model_cls._json_response(inserted)
        raise model_cls._wrap_model_error("save", exc) from exc
    finally:
        if owns_session:
            session.close()

