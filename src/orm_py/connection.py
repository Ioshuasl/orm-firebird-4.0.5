from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Optional, Union

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import ResourceClosedError
from .errors import OriusORMError


LoggerLike = Union[bool, Callable[[str], None]]


@dataclass(slots=True)
class ConnectionConfig:
    host: str = ""
    port: int = 0
    database: str = ""
    user: str = ""
    password: str = ""
    charset: str = "UTF8"
    pool_pre_ping: bool = True
    pool_size: int = 10
    max_overflow: int = 20
    echo: bool = False
    logging: LoggerLike = False
    connect_args: dict[str, Any] = field(default_factory=dict)
    client_library: Optional[str] = None
    connection_string: Optional[str] = None
    config_override: Optional[str] = None


class Connection:
    """Connection wrapper inspired by the TypeScript ORM Connection class."""

    def __init__(self, config: Union[ConnectionConfig, Mapping[str, Any], str]) -> None:
        normalized = self.normalize_config(config)
        self.config = normalized
        if normalized.client_library or normalized.config_override:
            try:
                from firebird.driver import driver_config

                if normalized.client_library:
                    driver_config.fb_client_library.value = normalized.client_library
                if normalized.config_override:
                    driver_config.db_defaults.config.value = normalized.config_override
            except Exception:
                # Keep startup resilient; connection error will be raised on first connect.
                pass
        connect_args = {"charset": normalized.charset, **(normalized.connect_args or {})}
        self._engine = create_engine(
            self._build_dsn(normalized),
            connect_args=connect_args,
            pool_pre_ping=normalized.pool_pre_ping,
            pool_size=normalized.pool_size,
            max_overflow=normalized.max_overflow,
            echo=normalized.echo,
            future=True,
        )

    @staticmethod
    def normalize_config(config: Union[ConnectionConfig, Mapping[str, Any], str]) -> ConnectionConfig:
        if isinstance(config, ConnectionConfig):
            normalized = config
        elif isinstance(config, str):
            # format: host/port:database or host:database or databaseAlias
            host = ""
            port = 0
            database = config.strip()
            if "/" in database and ":" in database:
                host_port, db_name = database.split(":", 1)
                host, port_part = host_port.split("/", 1)
                port = int(port_part)
                database = db_name
            elif ":" in database and "/" not in database:
                host, db_name = database.split(":", 1)
                database = db_name
            normalized = ConnectionConfig(host=host, port=port, database=database)
        else:
            data = dict(config)
            normalized = ConnectionConfig(
                host=str(data.get("host", "")).strip(),
                port=int(data.get("port", 0)),
                database=str(data.get("database", "")).strip(),
                user=str(data.get("user", "")).strip(),
                password=str(data.get("password", "")).strip(),
                charset=data.get("charset", "UTF8"),
                pool_pre_ping=bool(data.get("pool_pre_ping", True)),
                pool_size=int(data.get("pool_size", 10)),
                max_overflow=int(data.get("max_overflow", 20)),
                echo=bool(data.get("echo", False)),
                logging=data.get("logging", False),
                connect_args=dict(data.get("connect_args", {})),
                client_library=data.get("client_library"),
                connection_string=data.get("connection_string"),
                config_override=data.get("config_override"),
            )

        if not normalized.database:
            raise ValueError('Invalid configuration: "database" is required.')
        if not normalized.user:
            raise ValueError('Invalid configuration: "user" is required.')
        if not normalized.password:
            raise ValueError('Invalid configuration: "password" is required.')
        if not normalized.connection_string:
            if not normalized.host:
                raise ValueError('Invalid configuration: "host" is required when "connection_string" is not provided.')
            if not normalized.port:
                raise ValueError('Invalid configuration: "port" is required when "connection_string" is not provided.')
        return normalized

    @staticmethod
    def _build_dsn(config: ConnectionConfig) -> str:
        if config.connection_string:
            # Node-firebird style DSN: host/port:database
            return (
                f"firebird+firebird://{config.user}:{config.password}"
                f"@/{config.connection_string}"
            )
        # SQLAlchemy native style: host:port/database
        return (
            f"firebird+firebird://{config.user}:{config.password}"
            f"@{config.host}:{config.port}/{config.database}"
        )

    def get_engine(self) -> Engine:
        return self._engine

    def authenticate(self) -> None:
        try:
            with self._engine.connect() as conn:
                conn.execute(text("SELECT 1 AS OK FROM RDB$DATABASE"))
        except Exception as exc:
            raise OriusORMError(
                operation="authenticate",
                model=None,
                message="Falha ao autenticar conexão com Firebird",
                hint="Verifique host/port/database/user/password e configuração do fbclient/auth plugin.",
                original_error=exc,
            ) from exc

    def execute(self, sql: str, params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        self._log(sql)
        try:
            with self._engine.connect() as conn:
                result = conn.execute(text(sql), params or {})
                try:
                    rows = result.mappings().all()
                    return [dict(row) for row in rows]
                except ResourceClosedError:
                    conn.commit()
                    return []
        except Exception as exc:
            raise OriusORMError(
                operation="execute",
                model=None,
                message="Falha ao executar SQL",
                hint="Revise sintaxe SQL, permissões e constraints da tabela.",
                original_error=exc,
            ) from exc

    def close(self) -> None:
        self._engine.dispose()

    def _log(self, sql: str) -> None:
        if self.config.logging is True:
            print(f"[SQL] {sql}")
        elif callable(self.config.logging):
            self.config.logging(sql)
