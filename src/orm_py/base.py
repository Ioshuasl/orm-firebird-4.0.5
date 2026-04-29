from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional, Type, TypeVar, Union

from sqlalchemy.orm import DeclarativeBase, Session, SessionTransaction, sessionmaker

from .connection import Connection, ConnectionConfig
from .sync import SyncOptions, SyncResult, sync_orius_orm


class Base(DeclarativeBase):
    """Base declarative class for all ORM models."""


ModelType = TypeVar("ModelType", bound=Base)


class OriusTransaction:
    """Transaction handle used by query options: {"transaction": tx}."""

    def __init__(
        self,
        session: Session,
        session_tx: SessionTransaction,
        *,
        nested: bool = False,
    ) -> None:
        self.session = session
        self._session_tx = session_tx
        self.nested = nested


class OriusORM:
    """
    Sequelize-like central ORM object:
    - keeps a shared connection
    - registers models
    - provides sync/authenticate/close
    """

    def __init__(self, config: Union[ConnectionConfig, dict[str, Any], str]) -> None:
        self._connection = Connection(config)
        self._session_factory = sessionmaker(
            bind=self._connection.get_engine(),
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
            future=True,
        )
        self.models: Dict[str, Type[Base]] = {}
        self._active_tx: contextvars.ContextVar[Optional[OriusTransaction]] = contextvars.ContextVar(
            "orius_active_tx", default=None
        )

    def get_connection(self) -> Connection:
        return self._connection

    def authenticate(self) -> None:
        self._connection.authenticate()

    def close(self) -> None:
        self._connection.close()

    @contextmanager
    def session(self) -> Iterator[Session]:
        session = self._session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    @contextmanager
    def transaction(self, parent: Optional[OriusTransaction] = None) -> Iterator[OriusTransaction]:
        """
        Transaction context with nested support.

        Usage:
            with orm.transaction() as tx:
                Model.create({...}, {"transaction": tx})
                with orm.transaction(tx) as nested_tx:
                    Model.update({...}, {"transaction": nested_tx})
        """
        inherited = parent or self._active_tx.get()
        owns_session = inherited is None
        session = inherited.session if inherited is not None else self._session_factory()
        session_tx = session.begin_nested() if inherited is not None else session.begin()
        tx = OriusTransaction(session, session_tx, nested=inherited is not None)
        token = self._active_tx.set(tx)
        try:
            with session_tx:
                yield tx
        finally:
            self._active_tx.reset(token)
            if owns_session:
                session.close()

    def register_model(self, model_class: Type[ModelType]) -> Type[ModelType]:
        model_name = str(getattr(model_class, "modelName", None) or model_class.__name__)
        table_name = str(
            getattr(model_class, "tableName", None)
            or getattr(model_class, "__tablename__", model_name)
        ).upper()
        self.models[model_name] = model_class
        self.models[table_name] = model_class
        setattr(model_class, "_orm", self)
        return model_class

    def define(
        self,
        model_class_or_name: Union[Type[ModelType], str],
        table_or_attributes: Union[str, Dict[str, Dict[str, Any]]],
        options: Optional[Dict[str, Any]] = None,
    ) -> Type[ModelType]:
        """
        Sequelize-like overloads:
        - define(ModelClass, tableName)
        - define("ModelName", attributes, options?)
        """
        options = options or {}
        if not isinstance(model_class_or_name, str):
            model_class = model_class_or_name
            table_name = str(table_or_attributes)
            setattr(model_class, "tableName", table_name)
            setattr(model_class, "__tablename__", table_name)
            self.register_model(model_class)
            return model_class

        from .model import Model

        model_name = model_class_or_name
        attributes = table_or_attributes
        table_name = str(options.get("tableName") or model_name.upper())
        dynamic_model = type(
            model_name,
            (Model,),
            {"__module__": "orm_py.dynamic", "__abstract__": True},
        )
        setattr(dynamic_model, "modelName", model_name)
        init_options = {**options, "tableName": table_name, "modelName": model_name, "orm": self}
        dynamic_model.init(attributes, init_options)
        return dynamic_model

    def init(
        self,
        model_class: Type[ModelType],
        attributes: Dict[str, Dict[str, Any]],
        options: Optional[Dict[str, Any]] = None,
    ) -> Type[ModelType]:
        options = options or {}
        model_name = str(options.get("modelName") or getattr(model_class, "modelName", None) or model_class.__name__)
        table_name = str(
            options.get("tableName")
            or getattr(model_class, "tableName", None)
            or model_name.upper()
        )
        setattr(model_class, "modelName", model_name)
        init_options = {**options, "tableName": table_name, "modelName": model_name, "orm": self}
        model_class.init(attributes, init_options)
        return model_class

    def model(self, name: str) -> Type[Base]:
        resolved = self.models.get(name) or self.models.get(name.upper())
        if resolved is None:
            raise KeyError(f'Model "{name}" is not registered.')
        return resolved

    def sync(self, options: Optional[SyncOptions] = None) -> SyncResult:
        return sync_orius_orm(self, options or SyncOptions())
