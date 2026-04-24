import { DataType } from '../orm/data-types';
import { Model } from '../orm/model';
import { orm } from '../orm/client';

export const G_USUARIO_ATTRIBUTES = {
    ANDAMENTO_PADRAO2: { type: DataType.BIGINT },
    ANDAMENTO_PADRAO: { type: DataType.BIGINT },
    DATA_EXPIRACAO: { type: DataType.TIMESTAMP },
    ULTIMO_LOGIN_REGS: { type: DataType.TIMESTAMP },
    ULTIMO_LOGIN: { type: DataType.TIMESTAMP },
    USUARIO_ID: {
        type: DataType.BIGINT,
        primaryKey: true,
        autoIncrement: false
    },
    LOGIN: { type: DataType.STRING },
    USUARIO_TAB: { type: DataType.BIGINT },
    FOTO: { type: DataType.BINARY },
    SIGLA: { type: DataType.STRING },
    SENHA_ANTERIOR: { type: DataType.STRING },
    LEMBRETE_RESPOSTA: { type: DataType.STRING },
    LEMBRETE_PERGUNTA: { type: DataType.STRING },
    SENHA: { type: DataType.STRING },
    NOME_COMPLETO: { type: DataType.STRING },
    FUNCAO: { type: DataType.STRING },
    EMAIL: { type: DataType.STRING },
    RECEBER_MENSAGEM_ARROLAMENTO: { type: DataType.STRING },
    TROCARSENHA: { type: DataType.STRING },
    SITUACAO: { type: DataType.STRING },
    ASSINA: { type: DataType.STRING },
    ASSINA_CERTIDAO: { type: DataType.STRING },
    RECEBER_EMAIL_PENHORA: { type: DataType.STRING },
    NAO_RECEBER_CHAT_TODOS: { type: DataType.STRING },
    PODE_ALTERAR_CAIXA: { type: DataType.STRING },
    RECEBER_CHAT_CERTIDAO_ONLINE: { type: DataType.STRING },
    RECEBER_CHAT_CANCELAMENTO: { type: DataType.STRING },
    CPF: { type: DataType.STRING },
    SOMENTE_LEITURA: { type: DataType.STRING },
    RECEBER_CHAT_ENVIO_ONR: { type: DataType.STRING },
    TIPO_USUARIO: { type: DataType.STRING },
    DISTRIBUIR_PROTOCOLO_RI: { type: DataType.STRING },
    ULTIMO_PROTOCOLO_RI: { type: DataType.BIGINT },
    ADM_DISTRIBUIR_PROTOCOLO_RI: { type: DataType.STRING },
    SENHA_API: { type: DataType.STRING }
};

class GUsuarioModel extends Model {}

export const G_USUARIO = orm.init(GUsuarioModel, G_USUARIO_ATTRIBUTES, {
    modelName: 'G_USUARIO',
    tableName: 'G_USUARIO',
    primaryKey: 'USUARIO_ID'
});
