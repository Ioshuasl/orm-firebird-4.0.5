from __future__ import annotations

import importlib.metadata as metadata
import json
import os
import traceback
from decimal import Decimal
from pathlib import Path
from typing import Dict

from orm_py.base import OriusORM
from orm_py.utils.charset import is_ansi_charset, normalize_firebird_charset
from models.G_USUARIO import define_g_usuario
from models.T_ATO import define_t_ato


def load_dotenv(path: str = ".env") -> Dict[str, str]:
    data: Dict[str, str] = {}
    env_path = Path(path)
    if not env_path.exists():
        return data

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def run_crud_g_usuario(G_USUARIO: object) -> None:
    print("\n===== CRUD INICIAL: G_USUARIO =====")
    candidate_id = 995000
    while G_USUARIO.findByPk(Decimal(f"{candidate_id}.00")):
        candidate_id += 1
    pk = Decimal(f"{candidate_id}.00")

    created = G_USUARIO.create({"USUARIO_ID": pk})
    print("create:", json.dumps(created, ensure_ascii=False, default=str))

    found = G_USUARIO.findByPk(pk)
    print("findByPk:", json.dumps(found, ensure_ascii=False, default=str))

    listed = G_USUARIO.findAll({"where": {"USUARIO_ID": pk}, "limit": 5})
    print("findAll:", json.dumps(listed, ensure_ascii=False, default=str))

    counted = G_USUARIO.count({"where": {"USUARIO_ID": pk}})
    print("count:", json.dumps(counted, ensure_ascii=False, default=str))

    updated = G_USUARIO.update({"LOGIN": "ORM_FIREBIRD_PY_TEST"}, {"where": {"USUARIO_ID": pk}})
    print("update:", json.dumps(updated, ensure_ascii=False, default=str))

    destroyed = G_USUARIO.destroy({"where": {"USUARIO_ID": pk}})
    print("destroy:", json.dumps(destroyed, ensure_ascii=False, default=str))


def run_crud_t_ato(T_ATO: object) -> None:
    print("\n===== CRUD INICIAL: T_ATO =====")
    latest_rows = T_ATO.findAll(
        {
            "attributes": ["ATO_ID", "PROTOCOLO", "USUARIO_ID", "LIVRO_ANDAMENTO_ID", "ATO_TIPO_ID"],
            "order": [("ATO_ID", "DESC")],
            "limit": 1,
        }
    )
    print("findAll (seed):", json.dumps(latest_rows, ensure_ascii=False, default=str))

    counted = T_ATO.count({})
    print("count:", json.dumps(counted, ensure_ascii=False, default=str))

    if not latest_rows:
        print("T_ATO sem registros para teste de update/destroy.")
        return

    seed = latest_rows[0]
    seed_id = Decimal(str(seed["ATO_ID"]))
    by_pk = T_ATO.findByPk(seed_id)
    print("findByPk:", json.dumps(by_pk, ensure_ascii=False, default=str))

    updated = T_ATO.update({"OBSERVACAO": "UPDATE TEST orm-firebird-py"}, {"where": {"ATO_ID": seed_id}})
    print("update:", json.dumps(updated, ensure_ascii=False, default=str))

    # Create + destroy em transacao para nao sujar base.
    temp_id = seed_id + Decimal("10000000")
    temp_proto = Decimal(str(seed.get("PROTOCOLO") or 1)) + Decimal("10000000")
    payload = {
        "ATO_ID": temp_id,
        "PROTOCOLO": temp_proto,
        "USUARIO_ID": seed.get("USUARIO_ID"),
        "LIVRO_ANDAMENTO_ID": seed.get("LIVRO_ANDAMENTO_ID"),
        "ATO_TIPO_ID": seed.get("ATO_TIPO_ID"),
    }
    payload = {k: v for k, v in payload.items() if v is not None}

    try:
        created = T_ATO.create(payload)
        print("create:", json.dumps(created, ensure_ascii=False, default=str))
        destroyed = T_ATO.destroy({"where": {"ATO_ID": temp_id}})
        print("destroy:", json.dumps(destroyed, ensure_ascii=False, default=str))
    except Exception as exc:
        print("create/destroy T_ATO falhou:", str(exc))


def resolve_runtime_charset(env: Dict[str, str], use_orius_env: bool) -> str:
    key = "ORIUS_API_FDB_CHARSET" if use_orius_env else "FDB_ENCODING"
    return normalize_firebird_charset(env.get(key), default="UTF8")


def build_orm_config(env: Dict[str, str], charset: str) -> Dict[str, object]:
    client_library = env.get("FDB_CLIENT_LIBRARY", r"C:\Program Files\Firebird\Firebird_4_0\fbclient.dll")
    client_library = str(Path(client_library))
    if Path(client_library).exists():
        os.environ["FIREBIRD_CLIENT_LIBRARY"] = client_library

    use_orius_env = all(env.get(k) for k in ("ORIUS_API_FDB_HOST", "ORIUS_API_FDB_NAME", "ORIUS_API_FDB_PORT"))
    if use_orius_env:
        host = env["ORIUS_API_FDB_HOST"]
        port = int(env.get("ORIUS_API_FDB_PORT", "3050"))
        database_name = env["ORIUS_API_FDB_NAME"]
        user = env.get("ORIUS_API_FDB_USER", "SYSDBA")
        password = env.get("ORIUS_API_FDB_PASSWORD", "masterkey")
        pool_pre_ping = env.get("ORIUS_API_FDB_POOL_PRE_PING", "true").strip().lower() in ("1", "true", "yes", "on")
        pool_size = int(env.get("ORIUS_API_FDB_POOL_SIZE", "5"))
        max_overflow = int(env.get("ORIUS_API_FDB_POOL_MAX_OVERFLOW", "10"))
        connection_string = None
        auth_plugin = env.get("ORIUS_API_FDB_PLUGIN_NAME", "").strip() or None
        config_override = env.get("ORIUS_API_FDB_CONFIG_OVERRIDE", "").strip() or None
    else:
        connection_string = env.get("FDB_CONNECTION_STRING", "127.0.0.1/3050:IOSHUA")
        host = "127.0.0.1"
        port = 3050
        database_name = connection_string.split(":", 1)[1] if ":" in connection_string else connection_string
        user = env.get("FDB_USER", "SYSDBA")
        password = env.get("FDB_PASSWORD", "masterkey")
        pool_pre_ping = True
        pool_size = 5
        max_overflow = 10
        auth_plugin = env.get("FDB_PLUGIN_NAME", "").strip() or None
        config_override = env.get("FDB_CONFIG_OVERRIDE", "").strip() or None

    connect_args = {"charset": charset}
    if auth_plugin:
        connect_args["auth_plugin_list"] = auth_plugin

    return {
        "host": host,
        "port": port,
        "database": database_name,
        "connection_string": connection_string,
        "user": user,
        "password": password,
        "charset": charset,
        "pool_pre_ping": pool_pre_ping,
        "pool_size": pool_size,
        "max_overflow": max_overflow,
        "echo": False,
        "logging": True,
        "connect_args": connect_args,
        "client_library": client_library if Path(client_library).exists() else None,
        "config_override": config_override,
    }


def create_orm_utf8(env: Dict[str, str]) -> OriusORM:
    config = build_orm_config(env, charset="UTF8")
    return OriusORM(config)


def create_orm_ansi(env: Dict[str, str]) -> OriusORM:
    config = build_orm_config(env, charset="ISO8859_1")
    return OriusORM(config)


def create_orm_from_env(env: Dict[str, str]) -> tuple[OriusORM, str]:
    use_orius_env = all(env.get(k) for k in ("ORIUS_API_FDB_HOST", "ORIUS_API_FDB_NAME", "ORIUS_API_FDB_PORT"))
    runtime_charset = resolve_runtime_charset(env, use_orius_env=use_orius_env)
    if is_ansi_charset(runtime_charset):
        return create_orm_ansi(env), "ISO8859_1"
    return create_orm_utf8(env), "UTF8"


def main() -> None:
    env = load_dotenv(".env")
    orm, runtime_charset = create_orm_from_env(env)

    try:
        client_library = env.get("FDB_CLIENT_LIBRARY", r"C:\Program Files\Firebird\Firebird_4_0\fbclient.dll")
        client_library = str(Path(client_library))
        if Path(client_library).exists():
            print(f"Usando fbclient: {client_library}")
        print(f"Charset de execução selecionado: {runtime_charset}")
        orm.authenticate()
        print("Conexao com Firebird autenticada com sucesso.")
        try:
            print("Pacote PyPI orm-firebird-py:", metadata.version("orm-firebird-py"))
        except Exception:
            print("Pacote PyPI orm-firebird-py: versao nao encontrada no ambiente atual.")

        rows = orm.get_connection().execute("SELECT 1 AS OK FROM RDB$DATABASE")
        print("Query de teste executada com sucesso:", json.dumps(rows, ensure_ascii=False, default=str))

        G_USUARIO = define_g_usuario(orm)
        T_ATO = define_t_ato(orm)
        run_crud_g_usuario(G_USUARIO)
        run_crud_t_ato(T_ATO)
    except Exception as exc:
        print("Falha ao conectar no Firebird.")
        print(f"Detalhe tecnico: {exc}")
        traceback.print_exc()
        print(
            "Verifique ORIUS_API_FDB_USER/ORIUS_API_FDB_PASSWORD (ou FDB_USER/FDB_PASSWORD) no .env e, "
            "se necessario, ajuste FDB_PLUGIN_NAME/FDB_CLIENT_LIBRARY/FDB_CONFIG_OVERRIDE."
        )
    finally:
        orm.close()
        print("Conexao encerrada.")


if __name__ == "__main__":
    main()
