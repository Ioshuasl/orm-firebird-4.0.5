from __future__ import annotations

from typing import Any, Dict, Optional, Type


def run_find_and_count_all(model_cls: Type[Any], options: Optional[Dict[str, Any]] = None) -> dict[str, Any]:
    options = options or {}
    count_options = dict(options)
    count_options.pop("limit", None)
    count_options.pop("offset", None)
    count_options.pop("order", None)
    total = model_cls.count(count_options)["count"]
    rows = model_cls.find_all(options)
    return model_cls._json_response({"count": total, "rows": rows})

