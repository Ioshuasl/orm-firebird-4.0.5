from __future__ import annotations

from enum import Enum
from typing import Any, Callable, Dict, List, Optional, TypedDict, Union
from sqlalchemy.types import UserDefinedType


class DataType(str, Enum):
    STRING = "VARCHAR"
    CHAR = "CHAR"
    INTEGER = "INTEGER"
    SMALLINT = "SMALLINT"
    BIGINT = "BIGINT"
    NUMERIC = "NUMERIC"
    FLOAT = "FLOAT"
    DOUBLE = "DOUBLE PRECISION"
    TEXT = "BLOB_TEXT"
    BINARY = "BLOB_BIN"
    BOOLEAN = "BOOLEAN"
    DATE = "DATE"
    TIME = "TIME"
    DATEONLY = "DATE"
    TIMESTAMP = "TIMESTAMP"
    DECIMAL = "DECIMAL"
    ENUM = "ENUM"
    BLOB = "BLOB"
    BLOB_BINARY = "BLOB SUB_TYPE BINARY"


class BlobSubTypeText(UserDefinedType):
    def get_col_spec(self, **kw: Any) -> str:
        return "BLOB SUB_TYPE TEXT"


class BlobSubTypeBinary(UserDefinedType):
    def get_col_spec(self, **kw: Any) -> str:
        return "BLOB SUB_TYPE BINARY"


class DataTypeDefinition(TypedDict, total=False):
    key: str
    sql: str
    length: int
    precision: int
    scale: int
    values: List[Union[str, int]]


DataTypeInput = Union[DataType, DataTypeDefinition, str]
ValidatorFn = Callable[[Any], Union[bool, str]]


class ColumnReferenceOptions(TypedDict, total=False):
    model: Union[str, object]
    key: str
    constraintName: str


class ColumnOptions(TypedDict, total=False):
    type: DataTypeInput
    primaryKey: bool
    autoIncrement: bool
    sequence: str
    allowNull: bool
    defaultValue: Any
    unique: bool
    references: ColumnReferenceOptions
    onUpdate: str
    onDelete: str
    validate: Union[Dict[str, Union[ValidatorFn, Any]], ValidatorFn]


class DataTypes:
    @staticmethod
    def STRING(length: int = 255) -> DataTypeDefinition:
        return {"key": "STRING", "sql": f"VARCHAR({length})", "length": length}

    @staticmethod
    def CHAR(length: int = 1) -> DataTypeDefinition:
        return {"key": "CHAR", "sql": f"CHAR({length})", "length": length}

    @staticmethod
    def INTEGER() -> DataTypeDefinition:
        return {"key": "INTEGER", "sql": "INTEGER"}

    @staticmethod
    def SMALLINT() -> DataTypeDefinition:
        return {"key": "SMALLINT", "sql": "SMALLINT"}

    @staticmethod
    def BIGINT() -> DataTypeDefinition:
        return {"key": "BIGINT", "sql": "BIGINT"}

    @staticmethod
    def NUMERIC(precision: int = 18, scale: int = 0) -> DataTypeDefinition:
        return {"key": "NUMERIC", "sql": f"NUMERIC({precision}, {scale})", "precision": precision, "scale": scale}

    @staticmethod
    def FLOAT() -> DataTypeDefinition:
        return {"key": "FLOAT", "sql": "FLOAT"}

    @staticmethod
    def DOUBLE() -> DataTypeDefinition:
        return {"key": "DOUBLE", "sql": "DOUBLE PRECISION"}

    @staticmethod
    def TEXT() -> DataTypeDefinition:
        return {"key": "TEXT", "sql": "BLOB SUB_TYPE TEXT"}

    @staticmethod
    def BLOB() -> DataTypeDefinition:
        return {"key": "BLOB", "sql": "BLOB"}

    @staticmethod
    def BLOB_TEXT() -> DataTypeDefinition:
        return {"key": "BLOB_TEXT", "sql": "BLOB SUB_TYPE TEXT"}

    @staticmethod
    def BLOB_BINARY() -> DataTypeDefinition:
        return {"key": "BLOB_BINARY", "sql": "BLOB SUB_TYPE BINARY"}

    @staticmethod
    def BOOLEAN() -> DataTypeDefinition:
        return {"key": "BOOLEAN", "sql": "BOOLEAN"}

    @staticmethod
    def DATE() -> DataTypeDefinition:
        return {"key": "DATE", "sql": "DATE"}

    @staticmethod
    def TIME() -> DataTypeDefinition:
        return {"key": "TIME", "sql": "TIME"}

    @staticmethod
    def DATEONLY() -> DataTypeDefinition:
        return {"key": "DATEONLY", "sql": "DATE"}

    @staticmethod
    def TIMESTAMP() -> DataTypeDefinition:
        return {"key": "TIMESTAMP", "sql": "TIMESTAMP"}

    @staticmethod
    def DECIMAL(precision: int = 18, scale: int = 2) -> DataTypeDefinition:
        return {"key": "DECIMAL", "sql": f"DECIMAL({precision}, {scale})", "precision": precision, "scale": scale}

    @staticmethod
    def ENUM(*values: Union[str, int]) -> DataTypeDefinition:
        return {"key": "ENUM", "sql": "VARCHAR(255)", "values": list(values)}


def is_text_type(tp: DataTypeInput) -> bool:
    if isinstance(tp, dict):
        return str(tp.get("key", "")).upper() == "TEXT"
    return str(tp).upper() in {"TEXT", "BLOB_TEXT"}

