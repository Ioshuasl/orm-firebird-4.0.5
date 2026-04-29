from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Type

AssociationType = Literal["hasOne", "belongsTo", "hasMany", "belongsToMany"]


@dataclass
class AssociationDefinition:
    type: AssociationType
    as_name: str
    source: Type[Any]
    target: Type[Any]
    foreign_key: str
    source_key: str
    target_key: str
    through: Optional[Type[Any]] = None
    other_key: Optional[str] = None


_associations_by_source: Dict[Type[Any], List[AssociationDefinition]] = {}


def _default_alias(target: Type[Any], assoc_type: AssociationType) -> str:
    base = str(getattr(target, "modelName", None) or getattr(target, "tableName", None) or target.__name__).lower()
    if assoc_type in ("hasMany", "belongsToMany"):
        return base if base.endswith("s") else f"{base}s"
    return base


def _register(source: Type[Any], association: AssociationDefinition) -> AssociationDefinition:
    items = _associations_by_source.get(source, [])
    idx = next((i for i, entry in enumerate(items) if entry.as_name == association.as_name), -1)
    if idx >= 0:
        items[idx] = association
    else:
        items.append(association)
    _associations_by_source[source] = items
    return association


def register_association(
    assoc_type: AssociationType,
    source: Type[Any],
    target: Type[Any],
    options: Optional[Dict[str, Any]] = None,
) -> AssociationDefinition:
    options = options or {}
    source_pk = str(options.get("sourceKey") or getattr(source, "primaryKey", "ID"))
    target_pk = str(options.get("targetKey") or getattr(target, "primaryKey", "ID"))
    if assoc_type == "belongsTo":
        computed_fk = f"{str(getattr(target, 'tableName', target.__name__)).upper()}_{target_pk.upper()}"
    else:
        computed_fk = f"{str(getattr(source, 'tableName', source.__name__)).upper()}_{source_pk.upper()}"
    association = AssociationDefinition(
        type=assoc_type,
        as_name=str(options.get("as") or _default_alias(target, assoc_type)),
        source=source,
        target=target,
        foreign_key=str(options.get("foreignKey") or computed_fk).upper(),
        source_key=source_pk.upper(),
        target_key=target_pk.upper(),
    )
    if assoc_type == "belongsToMany":
        association.through = options.get("through")
        association.other_key = str(options.get("otherKey") or f"{str(getattr(target, 'tableName', target.__name__)).upper()}_{target_pk.upper()}").upper()
    return _register(source, association)


def get_associations(source: Type[Any]) -> List[AssociationDefinition]:
    return _associations_by_source.get(source, [])


def find_association(
    source: Type[Any],
    association: Optional[str] = None,
    as_name: Optional[str] = None,
    model: Optional[Type[Any]] = None,
) -> Optional[AssociationDefinition]:
    items = get_associations(source)
    if association:
        return next((item for item in items if item.as_name == association), None)
    if as_name:
        return next((item for item in items if item.as_name == as_name), None)
    if model is not None:
        return next((item for item in items if item.target is model), None)
    return None
