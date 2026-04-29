from __future__ import annotations

from typing import Any


def run_is_new_record(instance: Any) -> bool:
    explicit = getattr(instance, "_is_new_record", None)
    if isinstance(explicit, bool):
        return explicit
    model_cls = instance.__class__
    pk_name = str(getattr(model_cls, "primaryKey", "ID"))
    return getattr(instance, pk_name, None) is None

