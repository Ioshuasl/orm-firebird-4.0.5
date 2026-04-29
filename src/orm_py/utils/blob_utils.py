from __future__ import annotations

import base64
import ast
import io
import json
import zlib
import zipfile
from xml.etree import ElementTree
from typing import Any, Dict, Iterable, Optional
from .charset import normalize_firebird_charset


def materialize_blob_value(
    value: Any,
    *,
    subtype: str = "binary",
    charset: str = "ISO8859_1",
    strict: bool = False,
    binary_mode: str = "bytes",
) -> Any:
    """
    Materialize blob-like values to deterministic Python types.

    Parameters:
    - subtype: "binary" | "text"
    - charset: used when subtype is "text"
    - strict: if True, raises errors; otherwise returns None on failures
    - binary_mode:
        - "bytes": keep raw bytes
        - "base64": return base64 string
    """
    if value is None:
        return None

    if isinstance(value, bytes):
        return _normalize_blob_bytes(
            value, subtype=subtype, charset=charset, strict=strict, binary_mode=binary_mode
        )

    if isinstance(value, str):
        if subtype.lower() == "text":
            return value
        # Binary subtype received as string from driver edge cases.
        raw = value.encode(charset, errors="replace")
        return _normalize_blob_bytes(
            raw, subtype="binary", charset=charset, strict=strict, binary_mode=binary_mode
        )

    # Unknown/unsupported shape for blob content.
    if strict:
        raise TypeError(f"Unsupported BLOB value type: {type(value).__name__}")
    return None


def materialize_blobs_in_row(
    row: Dict[str, Any],
    blob_fields: Optional[Dict[str, str]] = None,
    *,
    charset: str = "ISO8859_1",
    strict: bool = False,
    binary_mode: str = "bytes",
) -> Dict[str, Any]:
    """
    Materialize blob fields in a single row dict.

    blob_fields example:
      {
        "TEXTO": "binary",
        "DESCRICAO": "text",
      }
    """
    if not isinstance(row, dict):
        return row

    blob_fields = blob_fields or {}
    out: Dict[str, Any] = dict(row)
    for key, subtype in blob_fields.items():
        if key not in out:
            continue
        try:
            out[key] = materialize_blob_value(
                out.get(key),
                subtype=subtype,
                charset=charset,
                strict=strict,
                binary_mode=binary_mode,
            )
        except Exception:
            if strict:
                raise
            out[key] = None
    return out


def materialize_blobs_in_rows(
    rows: Iterable[Dict[str, Any]],
    blob_fields: Optional[Dict[str, str]] = None,
    *,
    charset: str = "ISO8859_1",
    strict: bool = False,
    binary_mode: str = "bytes",
) -> list[Dict[str, Any]]:
    """
    Materialize blob fields for a row list.
    """
    return [
        materialize_blobs_in_row(
            row,
            blob_fields=blob_fields,
            charset=charset,
            strict=strict,
            binary_mode=binary_mode,
        )
        for row in rows
    ]


def detect_binary_format(blob: Optional[bytes], *, charset: str = "UTF8") -> Dict[str, Any]:
    """
    Best-effort binary format detection based on magic bytes.
    """
    if blob is None:
        return {"format": "unknown", "mime": None, "extension": None, "reason": "null"}
    normalized_charset = normalize_firebird_charset(charset)
    data = _coerce_blob_to_bytes(blob, charset=normalized_charset)
    if data is None:
        return {"format": "unknown", "mime": None, "extension": None, "reason": "not-bytes"}
    if len(data) == 0:
        return {"format": "empty", "mime": "application/octet-stream", "extension": None}

    if data.startswith(b"{\\rtf"):
        return {"format": "rtf", "mime": "application/rtf", "extension": ".rtf", "size": len(data)}

    signatures = [
        (b"\x89PNG\r\n\x1a\n", "png", "image/png", ".png"),
        (b"\xff\xd8\xff", "jpeg", "image/jpeg", ".jpg"),
        (b"GIF87a", "gif", "image/gif", ".gif"),
        (b"GIF89a", "gif", "image/gif", ".gif"),
        (b"BM", "bmp", "image/bmp", ".bmp"),
        (b"RIFF", "riff", "application/octet-stream", ".riff"),
        (b"%PDF-", "pdf", "application/pdf", ".pdf"),
        (b"PK\x03\x04", "zip", "application/zip", ".zip"),
        (b"\x1f\x8b", "gzip", "application/gzip", ".gz"),
        (b"OggS", "ogg", "application/ogg", ".ogg"),
        (b"\x00\x00\x01\x00", "ico", "image/x-icon", ".ico"),
    ]

    for sig, fmt, mime, ext in signatures:
        if data.startswith(sig):
            if fmt == "zip":
                docx_info = _detect_docx_from_zip_bytes(data)
                if docx_info is not None:
                    return docx_info
            return {"format": fmt, "mime": mime, "extension": ext, "size": len(data)}

    if _looks_like_zlib(data):
        inflated = _try_zlib_decompress(data)
        if inflated:
            nested = detect_binary_format(inflated, charset=normalized_charset)
            if nested.get("format") == "rtf":
                return {
                    "format": "rtf-zlib",
                    "mime": "application/rtf",
                    "extension": ".rtf",
                    "size": len(data),
                    "decoded_size": len(inflated),
                }
            return {
                "format": "zlib",
                "mime": "application/zlib",
                "extension": ".zlib",
                "size": len(data),
                "decoded": nested,
            }

    if _looks_like_utf8(data):
        text = data.decode("utf-8", errors="strict")
        if _looks_like_json_text(text):
            return {"format": "json", "mime": "application/json; charset=utf-8", "extension": ".json", "size": len(data)}
        if _looks_like_xml_text(text):
            return {"format": "xml", "mime": "application/xml; charset=utf-8", "extension": ".xml", "size": len(data)}
        return {"format": "txt", "mime": "text/plain; charset=utf-8", "extension": ".txt", "size": len(data)}
    if _looks_like_iso8859_1_text(data):
        text = data.decode("ISO8859_1", errors="replace")
        if _looks_like_json_text(text):
            return {
                "format": "json",
                "mime": "application/json; charset=iso-8859-1",
                "extension": ".json",
                "size": len(data),
            }
        if _looks_like_xml_text(text):
            return {
                "format": "xml",
                "mime": "application/xml; charset=iso-8859-1",
                "extension": ".xml",
                "size": len(data),
            }
        return {
            "format": "txt",
            "mime": "text/plain; charset=iso-8859-1",
            "extension": ".txt",
            "size": len(data),
        }

    return {"format": "binary", "mime": "application/octet-stream", "extension": ".bin", "size": len(data)}


def _normalize_blob_bytes(
    blob: bytes,
    *,
    subtype: str,
    charset: str,
    strict: bool,
    binary_mode: str,
) -> Any:
    if subtype.lower() == "text":
        try:
            return blob.decode(charset, errors="strict" if strict else "replace")
        except Exception:
            if strict:
                raise
            return blob.decode(charset, errors="replace")

    # binary subtype
    if binary_mode == "base64":
        return base64.b64encode(blob).decode("ascii")
    return blob


def _looks_like_utf8(data: bytes) -> bool:
    try:
        data.decode("utf-8", errors="strict")
        return True
    except Exception:
        return False


def _looks_like_iso8859_1_text(data: bytes) -> bool:
    # ISO-8859-1 decodes any byte sequence. We heuristically reject data
    # with too many control chars besides tab/newline/carriage return.
    ctrl = 0
    for b in data:
        if b < 32 and b not in (9, 10, 13):
            ctrl += 1
    return ctrl / max(len(data), 1) < 0.05


def _looks_like_json_text(text: str) -> bool:
    stripped = text.lstrip()
    if not stripped.startswith(("{", "[")):
        return False
    try:
        json.loads(text)
        return True
    except Exception:
        return False


def _looks_like_xml_text(text: str) -> bool:
    stripped = text.lstrip()
    if not stripped.startswith(("<?xml", "<")):
        return False
    try:
        ElementTree.fromstring(text)
        return True
    except Exception:
        return False


def _detect_docx_from_zip_bytes(data: bytes) -> Optional[Dict[str, Any]]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
            if "[Content_Types].xml" in names and "word/document.xml" in names:
                return {
                    "format": "docx",
                    "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "extension": ".docx",
                    "size": len(data),
                }
    except Exception:
        return None
    return None


def _coerce_blob_to_bytes(blob: Any, *, charset: str) -> Optional[bytes]:
    if isinstance(blob, bytes):
        return blob
    if isinstance(blob, bytearray):
        return bytes(blob)
    if isinstance(blob, memoryview):
        return blob.tobytes()
    if isinstance(blob, str):
        stripped = blob.strip()
        # Handles Python bytes repr string like: b'...'
        if (stripped.startswith("b'") and stripped.endswith("'")) or (
            stripped.startswith('b"') and stripped.endswith('"')
        ):
            try:
                parsed = ast.literal_eval(stripped)
                if isinstance(parsed, (bytes, bytearray)):
                    return bytes(parsed)
            except Exception:
                pass
        python_charset = "iso-8859-1" if normalize_firebird_charset(charset) == "ISO8859_1" else "utf-8"
        return blob.encode(python_charset, errors="replace")
    return None


def _looks_like_zlib(data: bytes) -> bool:
    # Most common zlib headers: 78 01, 78 5E, 78 9C, 78 DA
    return len(data) >= 2 and data[0] == 0x78 and data[1] in (0x01, 0x5E, 0x9C, 0xDA)


def _try_zlib_decompress(data: bytes) -> Optional[bytes]:
    try:
        return zlib.decompress(data)
    except Exception:
        return None

