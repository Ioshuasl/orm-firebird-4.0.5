import { Model } from '../orm/model';
import { DataType } from '../orm/data-types';

export class Ato extends Model {
    protected static tableName = 'T_ATO';
    protected static primaryKey = 'ATO_ID';

    protected static schema = {
        ATO_ID: { 
            type: DataType.BIGINT, // Ajustado para BIGINT conforme o JSON
            primaryKey: true, 
            autoIncrement: true, // Isso ativará o fallback MAX+1 se não houver sequence
        },
        ATO_TIPO_ID: { type: DataType.INTEGER },
        PROTOCOLO: { type: DataType.INTEGER },
        SITUACAO_ATO: { type: DataType.STRING },
        OBSERVACAO: { type: DataType.STRING },
        TEXTO: { type: DataType.TEXT }, // Campo BLOB Sub_type 1
        TEXTO_ASSINATURA: { type: DataType.BINARY }, // Campo BLOB Sub_type 0
        VALOR_PAGAMENTO: { type: DataType.DECIMAL },
        DATA_LAVRATURA: { type: DataType.TIMESTAMP }
    };
}