from __future__ import annotations

from typing import Any


def run_get(instance: Any, key: str) -> Any:
    return getattr(instance, key, None)

