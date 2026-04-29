from __future__ import annotations

from typing import Any


def run_previous(instance: Any, key: str | None = None) -> Any:
    previous = getattr(instance, "_previous_data_values", None) or {}
    if key is None:
        return dict(previous)
    return previous.get(key)

