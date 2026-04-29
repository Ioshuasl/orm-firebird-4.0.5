from __future__ import annotations

from typing import Any, Dict, List, Optional, Type


def _get_primary_key_names(model_cls: Type[Any]) -> List[str]:
    schema = getattr(model_cls, "schema", {}) or {}
    pks = [name for name, col in schema.items() if bool(col.get("primaryKey"))]
    if pks:
        return pks
    return [str(getattr(model_cls, "primaryKey", "ID"))]


def _where_for_find_by_pk(model_cls: Type[Any], identifier: Any) -> Dict[str, Any]:
    names = _get_primary_key_names(model_cls)
    if not names:
        raise ValueError("findByPk: model has no primary key defined.")

    if len(names) == 1:
        key = names[0]
        if isinstance(identifier, list):
            if not identifier:
                return {}
            return {key: identifier[0]}
        if isinstance(identifier, dict) and key in identifier:
            return {key: identifier[key]}
        return {key: identifier}

    if isinstance(identifier, list):
        if len(identifier) != len(names):
            raise ValueError(
                f"findByPk: composite key expects {len(names)} values, received {len(identifier)}."
            )
        return {name: identifier[idx] for idx, name in enumerate(names)}

    if isinstance(identifier, dict):
        where: Dict[str, Any] = {}
        for name in names:
            if name not in identifier:
                raise ValueError(f'findByPk: composite key missing field "{name}".')
            where[name] = identifier[name]
        return where

    raise ValueError(
        "findByPk: for composite keys use list (ordered) or object with all key fields."
    )


def run_find_by_pk(
    model_cls: Type[Any],
    identifier: Any,
    options: Optional[Dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    if identifier is None:
        return None

    where_pk = _where_for_find_by_pk(model_cls, identifier)
    if not where_pk:
        return None

    merged_options = dict(options or {})
    merged_where = {**(merged_options.get("where") or {}), **where_pk}
    merged_options["where"] = merged_where
    return model_cls.find_one(merged_options)

