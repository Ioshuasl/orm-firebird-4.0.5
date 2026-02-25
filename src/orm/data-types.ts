export enum DataType {
    STRING = 'VARCHAR',
    INTEGER = 'INTEGER',
    BIGINT = 'BIGINT',
    TEXT = 'BLOB_TEXT',   // Para campos de texto longo (Sub_type 1)
    BINARY = 'BLOB_BIN',  // Para assinaturas digitais/imagens (Sub_type 0)
    DATE = 'DATE',
    TIMESTAMP = 'TIMESTAMP',
    DECIMAL = 'DECIMAL'
}

export interface ColumnOptions {
    type: DataType;
    primaryKey?: boolean;
    autoIncrement?: boolean;
    sequence?: string; // Nome do Generator/Sequence no Firebird
    allowNull?: boolean;
    defaultValue?: any;
}