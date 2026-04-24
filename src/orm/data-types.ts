export enum DataType {
    STRING = 'VARCHAR',
    CHAR = 'CHAR',
    INTEGER = 'INTEGER',
    SMALLINT = 'SMALLINT',
    BIGINT = 'BIGINT',
    NUMERIC = 'NUMERIC',
    FLOAT = 'FLOAT',
    DOUBLE = 'DOUBLE PRECISION',
    TEXT = 'BLOB_TEXT',   // Para campos de texto longo (Sub_type 1)
    BINARY = 'BLOB_BIN',  // Para assinaturas digitais/imagens (Sub_type 0)
    BOOLEAN = 'BOOLEAN',
    DATE = 'DATE',
    TIME = 'TIME',
    DATEONLY = 'DATE',
    TIMESTAMP = 'TIMESTAMP',
    DECIMAL = 'DECIMAL',
    ENUM = 'ENUM'
}

export type ValidatorFn = (value: any) => boolean | string | Promise<boolean | string>;

export interface DataTypeDefinition {
    key: string;
    sql: string;
    length?: number;
    precision?: number;
    scale?: number;
    values?: Array<string | number>;
}

export type DataTypeInput = DataType | DataTypeDefinition;

export interface ModelReferenceLike {
    modelName?: string;
    tableName?: string;
    name?: string;
}

export interface ColumnReferenceOptions {
    model: string | ModelReferenceLike | Function;
    key: string;
    /** Nome do constraint FK no banco; se ausente, é gerado em `sync`. */
    constraintName?: string;
}

export interface ColumnOptions {
    type: DataTypeInput;
    primaryKey?: boolean;
    autoIncrement?: boolean;
    sequence?: string; // Nome do Generator/Sequence no Firebird
    allowNull?: boolean;
    defaultValue?: any;
    unique?: boolean;
    references?: ColumnReferenceOptions;
    onUpdate?: 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET NULL' | 'SET DEFAULT';
    onDelete?: 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET NULL' | 'SET DEFAULT';
    /**
     * Função única ou registo: funções `ValidatorFn` e/ou **validadores built-in** (ex.: `isEmail: true`,
     * `len: [0, 255]`, `isIn: [['A','B']]`, `not: { isEmail: true }` — ver `BUILTIN_VALIDATOR_NAMES` em
     * `validators.ts`).
     */
    validate?: Record<string, ValidatorFn | unknown> | ValidatorFn;
}

function createDefinition(definition: DataTypeDefinition): DataTypeDefinition {
    return Object.freeze(definition);
}

export const DataTypes = {
    STRING(length = 255): DataTypeDefinition {
        return createDefinition({ key: 'STRING', sql: `VARCHAR(${length})`, length });
    },
    CHAR(length = 1): DataTypeDefinition {
        return createDefinition({ key: 'CHAR', sql: `CHAR(${length})`, length });
    },
    INTEGER(): DataTypeDefinition {
        return createDefinition({ key: 'INTEGER', sql: 'INTEGER' });
    },
    SMALLINT(): DataTypeDefinition {
        return createDefinition({ key: 'SMALLINT', sql: 'SMALLINT' });
    },
    BIGINT(): DataTypeDefinition {
        return createDefinition({ key: 'BIGINT', sql: 'BIGINT' });
    },
    NUMERIC(precision = 18, scale = 0): DataTypeDefinition {
        return createDefinition({ key: 'NUMERIC', sql: `NUMERIC(${precision}, ${scale})`, precision, scale });
    },
    FLOAT(): DataTypeDefinition {
        return createDefinition({ key: 'FLOAT', sql: 'FLOAT' });
    },
    DOUBLE(): DataTypeDefinition {
        return createDefinition({ key: 'DOUBLE', sql: 'DOUBLE PRECISION' });
    },
    TEXT(): DataTypeDefinition {
        return createDefinition({ key: 'TEXT', sql: 'BLOB SUB_TYPE TEXT' });
    },
    BLOB(): DataTypeDefinition {
        return createDefinition({ key: 'BLOB', sql: 'BLOB' });
    },
    BOOLEAN(): DataTypeDefinition {
        return createDefinition({ key: 'BOOLEAN', sql: 'BOOLEAN' });
    },
    DATE(): DataTypeDefinition {
        return createDefinition({ key: 'DATE', sql: 'DATE' });
    },
    TIME(): DataTypeDefinition {
        return createDefinition({ key: 'TIME', sql: 'TIME' });
    },
    DATEONLY(): DataTypeDefinition {
        return createDefinition({ key: 'DATEONLY', sql: 'DATE' });
    },
    TIMESTAMP(): DataTypeDefinition {
        return createDefinition({ key: 'TIMESTAMP', sql: 'TIMESTAMP' });
    },
    DECIMAL(precision = 18, scale = 2): DataTypeDefinition {
        return createDefinition({ key: 'DECIMAL', sql: `DECIMAL(${precision}, ${scale})`, precision, scale });
    },
    ENUM(...values: Array<string | number>): DataTypeDefinition {
        return createDefinition({ key: 'ENUM', sql: 'VARCHAR(255)', values });
    }
};

export function isTextType(type: DataTypeInput): boolean {
    if (typeof type === 'string') return type === DataType.TEXT;
    return type.key.toUpperCase() === 'TEXT';
}