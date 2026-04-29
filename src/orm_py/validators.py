from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Callable, Mapping
from urllib.parse import urlparse
from uuid import UUID

ValidatorFn = Callable[[Any], bool | str]

BUILTIN_VALIDATOR_NAMES = {
    "notempty",
    "isnull",
    "isin",
    "notin",
    "min",
    "max",
    "len",
    "isemail",
    "isurl",
    "isip",
    "isuuid",
    "isdate",
    "isint",
    "isfloat",
    "isdecimal",
    "isnumeric",
    "isalpha",
    "isalphanumeric",
    "matches",
    "contains",
    "notcontains",
    "isafter",
    "isbefore",
    "equals",
    "not",
}

RE_EMAIL = re.compile(r"^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,63}$", re.I)
RE_INT = re.compile(r"^-?\d+$")
RE_NUMERIC = re.compile(r"^-?\d+(\.\d+)?([eE][+\-]?\d+)?$")
RE_ALPHA = re.compile(r"^[A-Za-zÀ-ÿ\u0100-\uFFFF]+$")
RE_ALNUM = re.compile(r"^[0-9A-Za-zÀ-ÿ\u0100-\uFFFF]+$")
RE_IPV4 = re.compile(r"^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$")


def is_builtin_validator_key(name: str) -> bool:
    return str(name).lower() in BUILTIN_VALIDATOR_NAMES


def _unpack(spec: Any) -> tuple[Any, str | None]:
    if isinstance(spec, Mapping) and ("args" in spec or "msg" in spec):
        return spec.get("args"), spec.get("msg")
    return spec, None


def _to_date(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value)
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _is_blank_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    if isinstance(value, (list, tuple, set)) and len(value) == 0:
        return True
    return False


def _parse_allowed_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        if len(value) > 0 and isinstance(value[0], (list, tuple)):
            return list(value[0])
        return list(value)
    return [value]


def run_not_validator(spec: Any, value: Any, field_key: str, msg: str | None = None) -> bool | str:
    inner = spec.get("not") if isinstance(spec, Mapping) else None
    if callable(inner):
        result = inner(value)
        if result is True:
            return msg or f"{field_key} is invalid."
        return True
    if isinstance(inner, Mapping):
        for key, entry in inner.items():
            if is_builtin_validator_key(str(key)) and not callable(entry):
                result = build_builtin_validator(str(key), entry, field_key)(value)
                if result is True:
                    return msg or f"{field_key} is invalid."
                continue
            if callable(entry):
                result = entry(value)
                if result is True:
                    return msg or f"{field_key} is invalid."
    return True


def build_builtin_validator(validator_name: str, spec: Any, field_key: str) -> ValidatorFn:
    name = validator_name.lower()
    arg, msg = _unpack(spec)

    if name == "not":
        return lambda value: run_not_validator(spec, value, field_key, msg)

    def _validator(value: Any) -> bool | str:
        if name == "notempty":
            if _is_blank_value(value):
                return msg or f"{field_key} cannot be empty."
            return True
        if name == "isnull":
            if value is not None:
                return msg or f"{field_key} must be null."
            return True
        if name in ("isin", "notin"):
            if value is None:
                return True
            options = _parse_allowed_list(arg)
            hit = any((x == value) for x in options)
            if name == "isin" and not hit:
                return msg or f"{field_key} is not a valid choice."
            if name == "notin" and hit:
                return msg or f"{field_key} is not an allowed value."
            return True
        if name in ("min", "max"):
            if value is None:
                return True
            try:
                n = float(arg)
            except Exception:
                return True
            if name == "min":
                if isinstance(value, (int, float)) and float(value) < n:
                    return msg or f"{field_key} must be >= {n:g}."
                if isinstance(value, str) and len(value) < int(n):
                    return msg or f"{field_key} is too short (min {int(n)})."
                if isinstance(value, (list, tuple, set)) and len(value) < int(n):
                    return msg or f"{field_key} has too few elements."
            if name == "max":
                if isinstance(value, (int, float)) and float(value) > n:
                    return msg or f"{field_key} must be <= {n:g}."
                if isinstance(value, str) and len(value) > int(n):
                    return msg or f"{field_key} is too long (max {int(n)})."
                if isinstance(value, (list, tuple, set)) and len(value) > int(n):
                    return msg or f"{field_key} has too many elements."
            return True
        if name == "len":
            if value is None:
                return True
            pair = arg if isinstance(arg, (list, tuple)) and len(arg) >= 2 else None
            if not pair:
                return True
            lo, hi = int(pair[0]), int(pair[1])
            if isinstance(value, (str, list, tuple, set)):
                size = len(value)
                if size < lo or size > hi:
                    return msg or f"{field_key} must have between {lo} and {hi} items."
            return True
        if value is None:
            return True
        if name == "isemail":
            if not RE_EMAIL.search(str(value)):
                return msg or f"{field_key} must be a valid email."
            return True
        if name == "isurl":
            parsed = urlparse(str(value))
            if not parsed.scheme or not parsed.netloc:
                return msg or f"{field_key} must be a valid URL."
            return True
        if name == "isip":
            if not RE_IPV4.search(str(value)):
                return msg or f"{field_key} must be a valid IPv4."
            return True
        if name == "isuuid":
            try:
                uid = UUID(str(value))
                if arg == 4 and uid.version != 4:
                    return msg or f"{field_key} must be a valid UUID v4."
            except Exception:
                return msg or f"{field_key} must be a valid UUID."
            return True
        if name == "isdate":
            if _to_date(value) is None:
                return msg or f"{field_key} must be a valid date."
            return True
        if name == "isint":
            if not RE_INT.search(str(value)):
                return msg or f"{field_key} must be an integer."
            return True
        if name in ("isfloat", "isdecimal", "isnumeric"):
            if not RE_NUMERIC.search(str(value)):
                return msg or f"{field_key} must be numeric."
            return True
        if name == "isalpha":
            if not RE_ALPHA.search(str(value)):
                return msg or f"{field_key} may only contain letters."
            return True
        if name == "isalphanumeric":
            if not RE_ALNUM.search(str(value)):
                return msg or f"{field_key} may only contain letters and numbers."
            return True
        if name == "matches":
            regex = None
            if isinstance(arg, re.Pattern):
                regex = arg
            elif isinstance(arg, (list, tuple)) and len(arg) > 0:
                regex = re.compile(str(arg[0]), str(arg[1]) if len(arg) > 1 else "")
            elif arg is not None:
                regex = re.compile(str(arg))
            if regex and not regex.search(str(value)):
                return msg or f"{field_key} has an invalid format."
            return True
        if name == "contains":
            if str(arg) not in str(value):
                return msg or f"{field_key} must contain the required value."
            return True
        if name == "notcontains":
            if str(arg) in str(value):
                return msg or f"{field_key} may not contain the forbidden value."
            return True
        if name in ("isafter", "isbefore"):
            a = _to_date(value)
            b = _to_date(arg)
            if a is None:
                return msg or f"{field_key} is not a valid date."
            if b is not None:
                if name == "isafter" and not (a > b):
                    return msg or f"{field_key} is not after the limit."
                if name == "isbefore" and not (a < b):
                    return msg or f"{field_key} is not before the limit."
            return True
        if name == "equals":
            if value != arg:
                return msg or f"{field_key} has an invalid value."
            return True
        return True

    return _validator


def run_validate_entry(key: str, validator_name: str, spec: Any, value: Any, _column: Mapping[str, Any]) -> bool | str:
    if validator_name.lower() == "not" and isinstance(spec, Mapping) and "not" in spec:
        return run_not_validator(spec, value, key, spec.get("msg"))
    if is_builtin_validator_key(validator_name) and not callable(spec):
        return build_builtin_validator(validator_name, spec, key)(value)
    if callable(spec):
        return spec(value)
    return f'{key}: invalid validate entry "{validator_name}" (expected built-in or function)'

