from __future__ import annotations

from typing import Any, Dict, Optional

from ..associations import AssociationDefinition, find_association


def normalize_include(include: Any) -> list[Dict[str, Any]]:
    if include is None:
        return []
    if isinstance(include, list):
        return [inc for inc in include if isinstance(inc, dict) or isinstance(inc, type)]
    return [include]


def normalize_include_list(include: Any) -> list[Dict[str, Any]]:
    items = normalize_include(include)
    normalized: list[Dict[str, Any]] = []
    for item in items:
        normalized.append(item if isinstance(item, dict) else {"model": item})
    return normalized


def infer_link_kind(association: Optional[AssociationDefinition], include_item: Dict[str, Any]) -> str:
    if association is not None:
        return association.type
    if include_item.get("separateType"):
        return str(include_item["separateType"])
    if include_item.get("on"):
        return "hasMany"
    return "hasMany"


def separate_eligible(association: Optional[AssociationDefinition], include_item: Dict[str, Any]) -> bool:
    if not bool(include_item.get("separate", False)):
        return False
    if association is not None:
        if association.type in ("hasMany", "hasOne", "belongsTo", "belongsToMany"):
            return True
        raise ValueError(f'include.separate: unsupported association type "{association.type}"')
    if include_item.get("model") and include_item.get("on"):
        return True
    raise ValueError(
        "include.separate: provide a registered association or (model + on) for manual join"
    )


def split_join_includes_and_collect_separate_plans(
    includes: list[Dict[str, Any]],
    source_model: Any,
    path_to_source: list[str],
    separate_out: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    join_only: list[Dict[str, Any]] = []
    for include_item in includes:
        if source_model is None and bool(include_item.get("separate", False)):
            raise ValueError("include.separate requires source model at root level")
        association = find_association(
            source_model,
            association=include_item.get("association"),
            as_name=include_item.get("as"),
            model=include_item.get("model"),
        )
        target_model = association.target if association is not None else include_item.get("model")
        raw_as = str(include_item.get("as") or (association.as_name if association is not None else "rel"))
        if separate_eligible(association, include_item):
            if target_model is None:
                raise ValueError(f'include.separate: target model missing for "{raw_as}"')
            separate_out.append(
                {
                    "pathToSource": list(path_to_source),
                    "as": raw_as,
                    "association": association,
                    "node": dict(include_item),
                    "sourceModel": source_model,
                    "targetModel": target_model,
                    "linkKind": infer_link_kind(association, include_item),
                }
            )
            continue

        nested_raw = normalize_include_list(include_item.get("include"))
        nested_join = (
            split_join_includes_and_collect_separate_plans(
                nested_raw,
                target_model if target_model is not None else source_model,
                path_to_source + [raw_as],
                separate_out,
            )
            if nested_raw
            else []
        )
        join_entry = dict(include_item)
        join_entry["include"] = nested_join or None
        join_only.append(join_entry)
    return join_only


def apply_order(model_cls: Any, stmt: Any, order: Optional[list[tuple[str, str]]]) -> Any:
    if not order:
        return stmt
    for column_name, direction in order:
        column = getattr(model_cls, column_name)
        stmt = stmt.order_by(column.desc() if str(direction).upper() == "DESC" else column.asc())
    return stmt

