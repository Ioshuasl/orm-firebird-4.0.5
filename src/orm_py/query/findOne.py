from __future__ import annotations

from typing import Any, Dict, Optional, Type


def run_find_one(model_cls: Type[Any], options: Optional[Dict[str, Any]] = None) -> Optional[dict[str, Any]]:
    merged = {**(options or {}), "limit": 1}
    rows = model_cls.find_all(merged)
    return rows[0] if rows else None

