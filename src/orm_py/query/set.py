from __future__ import annotations

from typing import Any


def run_set(instance: Any, key: str | dict[str, Any], value: Any = None) -> Any:
    if isinstance(key, str):
        setattr(instance, key, value)
        return instance
    for field, field_value in key.items():
        setattr(instance, field, field_value)
    return instance

