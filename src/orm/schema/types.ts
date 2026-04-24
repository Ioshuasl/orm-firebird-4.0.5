export type ReferentialAction =
    | 'CASCADE'
    | 'RESTRICT'
    | 'NO ACTION'
    | 'SET NULL'
    | 'SET DEFAULT'
    | string;

/**
 * Uma restrição de FK lida de `RDB$*` (foco em coluna única; composta pode aparecer
 * com o mesmo `constraintName` em múltiplas linhas).
 */
export type FirebirdForeignKeyInfo = {
    constraintName: string;
    childTable: string;
    childField: string;
    parentTable: string;
    parentField: string;
    onDelete: ReferentialAction;
    onUpdate: ReferentialAction;
    /** Ex.: 0, 1, … se composta. */
    segmentPosition: number;
};

export type ForeignKeyModelSpec = {
    constraintName: string;
    childTable: string;
    childField: string;
    parentTable: string;
    parentField: string;
    onDelete?: ReferentialAction;
    onUpdate?: ReferentialAction;
};

export type FirebirdColumnDescription = {
    tableName: string;
    columnName: string;
    dataType: string;
    nullable: boolean;
    defaultValue: string | null;
    length?: number;
    precision?: number;
    scale?: number;
    position: number;
};

export type FirebirdConstraintInfo = {
    constraintName: string;
    tableName: string;
    type: 'PRIMARY KEY' | 'UNIQUE' | 'FOREIGN KEY' | 'CHECK' | string;
    indexName?: string | null;
    referencedConstraintName?: string | null;
};

export type FirebirdIndexInfo = {
    indexName: string;
    tableName: string;
    unique: boolean;
    indexType: string;
    columns: string[];
};

export type SyncOptions = {
    /**
     * Sincroniza um subconjunto de models (nomes de classe ou de tabela).
     * Padrão: todos os `orm.models` (deduplicados por tabela).
     */
    modelNames?: string[];
    /** Apenas gera/enumera SQL, sem executar. */
    dryRun?: boolean;
    /** Derruba tabelas existentes (ordem: dependentes → pais) antes de recriar. Cuidado. */
    force?: boolean;
    /** Só FKs: não cria/altera tabelas, apenas aplica `ALTER TABLE ... ADD CONSTRAINT` em falta. */
    fksOnly?: boolean;
    /** Só tabelas + colunas, sem tocar em FK. */
    tablesOnly?: boolean;
    transaction?: any;
    logging?: boolean;
};

export type SyncResult = {
    createdTables: string[];
    createdForeignKeys: string[];
    droppedTables: string[];
    skipped: {
        existingTables: string[];
        existingForeignKeys: string[];
    };
    sql: string[];
};
