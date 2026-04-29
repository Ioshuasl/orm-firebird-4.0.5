from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class _OpToken:
    sql: str

    def __str__(self) -> str:
        return self.sql


class Op:
    eq = _OpToken("=")
    ne = _OpToken("<>")
    gt = _OpToken(">")
    gte = _OpToken(">=")
    lt = _OpToken("<")
    lte = _OpToken("<=")
    like = _OpToken("LIKE")
    notLike = _OpToken("NOT LIKE")
    in_ = _OpToken("IN")
    notIn = _OpToken("NOT IN")
    between = _OpToken("BETWEEN")
    notBetween = _OpToken("NOT BETWEEN")
    and_ = _OpToken("AND")
    or_ = _OpToken("OR")
    is_ = _OpToken("IS")
    not_ = _OpToken("NOT")

    # Sequelize-like aliases
    inOp = in_
    andOp = and_
    orOp = or_


def normalize_operator_key(key: Any) -> str:
    if isinstance(key, _OpToken):
        return key.sql.upper()
    raw = str(key).strip()
    if raw.startswith("$"):
        raw = raw[1:]
    return raw.upper()

