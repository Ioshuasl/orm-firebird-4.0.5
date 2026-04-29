from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class OriusORMError(Exception):
    operation: str
    model: Optional[str]
    message: str
    hint: Optional[str] = None
    original_error: Optional[Exception] = None

    def __str__(self) -> str:
        model_part = f"[{self.model}] " if self.model else ""
        hint_part = f" Dica: {self.hint}" if self.hint else ""
        return f"{model_part}{self.operation}: {self.message}.{hint_part}".strip()


@dataclass
class ValidationError(Exception):
    message: str
    errors: list[str]

    def __str__(self) -> str:
        details = "; ".join(self.errors)
        return f"{self.message}: {details}" if details else self.message

