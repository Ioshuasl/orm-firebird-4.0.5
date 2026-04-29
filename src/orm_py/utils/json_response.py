from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Any


def to_json_response(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(k): to_json_response(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_json_response(item) for item in value]

    # ORM/model-like object
    if hasattr(value, "__dict__"):
        output: dict[str, Any] = {}
        for key, item in vars(value).items():
            if key.startswith("_"):
                continue
            output[key] = to_json_response(item)
        return output

    return str(value)

