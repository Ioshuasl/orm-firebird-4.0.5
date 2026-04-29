from __future__ import annotations

from orm_py.base import OriusORM
from orm_py.data_types import DataType, DataTypes


def define_g_usuario(orm: OriusORM):
    return orm.define(
        "G_USUARIO",
        {
            "USUARIO_ID": {"type": DataTypes.NUMERIC(10, 2), "primaryKey": True, "autoIncrement": False},
            "TROCARSENHA": {"type": DataTypes.STRING(1)},
            "LOGIN": {"type": DataTypes.STRING(30)},
            "SENHA": {"type": DataTypes.STRING(60)},
            "SITUACAO": {"type": DataTypes.STRING(1)},
            "NOME_COMPLETO": {"type": DataTypes.STRING(150)},
            "FUNCAO": {"type": DataTypes.STRING(60)},
            "ASSINA": {"type": DataTypes.STRING(1)},
            "SIGLA": {"type": DataTypes.STRING(10)},
            "USUARIO_TAB": {"type": DataTypes.NUMERIC(10, 2)},
            "ULTIMO_LOGIN": {"type": DataType.TIMESTAMP},
            "ULTIMO_LOGIN_REGS": {"type": DataType.TIMESTAMP},
            "DATA_EXPIRACAO": {"type": DataType.TIMESTAMP},
            "SENHA_ANTERIOR": {"type": DataTypes.STRING(150)},
            "ANDAMENTO_PADRAO": {"type": DataTypes.NUMERIC(10, 2)},
            "LEMBRETE_PERGUNTA": {"type": DataTypes.STRING(60)},
            "LEMBRETE_RESPOSTA": {"type": DataTypes.STRING(60)},
            "ANDAMENTO_PADRAO2": {"type": DataTypes.NUMERIC(10, 2)},
            "RECEBER_MENSAGEM_ARROLAMENTO": {"type": DataTypes.STRING(1)},
            "EMAIL": {"type": DataTypes.STRING(260)},
            "ASSINA_CERTIDAO": {"type": DataTypes.STRING(1)},
            "RECEBER_EMAIL_PENHORA": {"type": DataTypes.STRING(1)},
            "FOTO": {"type": DataType.BINARY},
            "NAO_RECEBER_CHAT_TODOS": {"type": DataTypes.STRING(1)},
            "PODE_ALTERAR_CAIXA": {"type": DataTypes.STRING(1)},
            "RECEBER_CHAT_CERTIDAO_ONLINE": {"type": DataTypes.STRING(1)},
            "RECEBER_CHAT_CANCELAMENTO": {"type": DataTypes.STRING(1)},
            "CPF": {"type": DataTypes.STRING(15)},
            "SOMENTE_LEITURA": {"type": DataTypes.STRING(1)},
            "RECEBER_CHAT_ENVIO_ONR": {"type": DataTypes.STRING(1)},
            "TIPO_USUARIO": {"type": DataTypes.STRING(3)},
            "DISTRIBUIR_PROTOCOLO_RI": {"type": DataTypes.STRING(3)},
            "ULTIMO_PROTOCOLO_RI": {"type": DataTypes.NUMERIC(10, 2)},
            "SENHA_API": {"type": DataTypes.STRING(260)},
        },
        {
            "modelName": "G_USUARIO",
            "tableName": "G_USUARIO",
            "primaryKey": "USUARIO_ID",
        },
    )

