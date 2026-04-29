from __future__ import annotations

from typing import Any, Iterable


def _tracked_fields(instance: Any) -> list[str]:
    schema = getattr(instance.__class__, "schema", {}) or {}
    if schema:
        return list(schema.keys())
    return [k for k in vars(instance).keys() if not k.startswith("_")]


def run_changed(instance: Any, key: str | None = None) -> bool | list[str]:
    previous = getattr(instance, "_previous_data_values", None) or {}
    changed_keys: list[str] = []
    for field in _tracked_fields(instance):
        if getattr(instance, field, None) != previous.get(field):
            changed_keys.append(field)
    if key is not None:
        return key in changed_keys
    return changed_keys

