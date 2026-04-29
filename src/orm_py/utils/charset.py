from __future__ import annotations

from typing import Any


def normalize_firebird_charset(value: str | None, default: str = "UTF8") -> str:
    """
    Normalize charset name from env/config.
    Falls back to UTF8 when missing/blank/null-like.
    """
    raw = (value or "").strip()
    if not raw or raw.lower() in {"null", "none"}:
        return default.upper()
    upper = raw.upper().replace("-", "_")
    if upper in {"ANSI", "ANSI_CHARSET", "ISO8859_1", "ISO_8859_1", "ISO-8859-1"}:
        return "ISO8859_1"
    if upper in {"UTF8", "UTF_8", "UTF-8"}:
        return "UTF8"
    return upper


def is_ansi_charset(value: str | None) -> bool:
    return normalize_firebird_charset(value) == "ISO8859_1"


def decode_iso8859_1_bytes(value: bytes) -> str:
    """
    Decode raw bytes that are known to be ISO8859_1 into Unicode text.
    """
    return value.decode("iso-8859-1", errors="replace")


def fix_mojibake_iso8859_1(text: str) -> str:
    """
    Try to fix common mojibake like 'JoÃ£o' -> 'João'.
    If conversion is not valid, return original text.
    """
    try:
        return text.encode("iso-8859-1").decode("utf-8")
    except Exception:
        return text


def convert_iso8859_1_to_utf8(value: Any, fix_mojibake: bool = True) -> Any:
    """
    Recursively convert text payloads to UTF-8 friendly Python strings.

    Notes:
    - bytes are decoded as ISO8859_1 text
    - str values optionally pass through mojibake fixer
    - dict/list/tuple/set are converted recursively
    - unknown object instances are converted through __dict__
    """
    if value is None:
        return None
    if isinstance(value, bytes):
        return decode_iso8859_1_bytes(value)
    if isinstance(value, str):
        return fix_mojibake_iso8859_1(value) if fix_mojibake else value
    if isinstance(value, dict):
        return {k: convert_iso8859_1_to_utf8(v, fix_mojibake=fix_mojibake) for k, v in value.items()}
    if isinstance(value, list):
        return [convert_iso8859_1_to_utf8(item, fix_mojibake=fix_mojibake) for item in value]
    if isinstance(value, tuple):
        return tuple(convert_iso8859_1_to_utf8(item, fix_mojibake=fix_mojibake) for item in value)
    if isinstance(value, set):
        return {convert_iso8859_1_to_utf8(item, fix_mojibake=fix_mojibake) for item in value}
    if hasattr(value, "__dict__"):
        output: dict[str, Any] = {}
        for key, item in vars(value).items():
            if key.startswith("_"):
                continue
            output[key] = convert_iso8859_1_to_utf8(item, fix_mojibake=fix_mojibake)
        return output
    return value

