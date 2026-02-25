import { FirebirdDB } from '../database';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface para tipar as colunas no JSON de saída
 */
interface ColumnMetadata {
    nome: string;
    tipo: string;
    tamanho: number;
    precisao: number;
    escala: number;
    obrigatorio: boolean;
    auto_increment: boolean;
    default_value: string | null;
    primary_key: boolean;
    fk: {
        referencia_tabela: string;
        referencia_coluna: string;
    } | null;
}

interface TableMetadata {
    tabela: string;
    colunas: ColumnMetadata[];
}

async function exportMetadataToJson() {
    try {
        console.log("⏳ Iniciando extração avançada de metadados do Firebird 4.0...");

        // 1. Query de Colunas, Tipos, Precisão, Identity e Default
        const columnsSql = `
            SELECT 
                TRIM(R.RDB$RELATION_NAME) AS TABELA,
                TRIM(RF.RDB$FIELD_NAME) AS COLUNA,
                CASE F.RDB$FIELD_TYPE
                    WHEN 7 THEN 'SMALLINT'
                    WHEN 8 THEN 'INTEGER'
                    WHEN 10 THEN 'FLOAT'
                    WHEN 12 THEN 'DATE'
                    WHEN 13 THEN 'TIME'
                    WHEN 14 THEN 'CHAR'
                    WHEN 16 THEN 'BIGINT'
                    WHEN 27 THEN 'DOUBLE'
                    WHEN 35 THEN 'TIMESTAMP'
                    WHEN 37 THEN 'VARCHAR'
                    WHEN 261 THEN 'BLOB'
                    ELSE 'OUTRO'
                END AS TIPO_NOME,
                F.RDB$FIELD_LENGTH AS TAMANHO,
                COALESCE(F.RDB$FIELD_PRECISION, 0) AS PRECISAO,
                ABS(COALESCE(F.RDB$FIELD_SCALE, 0)) AS ESCALA,
                COALESCE(RF.RDB$NULL_FLAG, 0) AS REQUERIDO,
                COALESCE(RF.RDB$IDENTITY_TYPE, 0) AS IS_IDENTITY,
                TRIM(RF.RDB$DEFAULT_SOURCE) AS DEFAULT_VALUE
            FROM RDB$RELATIONS R
            JOIN RDB$RELATION_FIELDS RF ON R.RDB$RELATION_NAME = RF.RDB$RELATION_NAME
            JOIN RDB$FIELDS F ON RF.RDB$FIELD_SOURCE = F.RDB$FIELD_NAME
            WHERE R.RDB$SYSTEM_FLAG = 0 
              AND R.RDB$RELATION_TYPE = 0
              AND R.RDB$VIEW_BLR IS NULL
            ORDER BY R.RDB$RELATION_NAME, RF.RDB$FIELD_POSITION;
        `;

        // 2. Query de Foreign Keys
        const fksSql = `
            SELECT
                TRIM(RC.RDB$RELATION_NAME) AS TABELA_ORIGEM,
                TRIM(ISEG.RDB$FIELD_NAME) AS COLUNA_ORIGEM,
                TRIM(RCREF.RDB$RELATION_NAME) AS TABELA_DESTINO,
                TRIM(ISEGREF.RDB$FIELD_NAME) AS COLUNA_DESTINO
            FROM RDB$RELATION_CONSTRAINTS RC
            JOIN RDB$REF_CONSTRAINTS REFC ON RC.RDB$CONSTRAINT_NAME = REFC.RDB$CONSTRAINT_NAME
            JOIN RDB$RELATION_CONSTRAINTS RCREF ON REFC.RDB$CONST_NAME_UQ = RCREF.RDB$CONSTRAINT_NAME
            JOIN RDB$INDEX_SEGMENTS ISEG ON RC.RDB$INDEX_NAME = ISEG.RDB$INDEX_NAME
            JOIN RDB$INDEX_SEGMENTS ISEGREF ON RCREF.RDB$INDEX_NAME = ISEGREF.RDB$INDEX_NAME
            WHERE RC.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
        `;

        // 3. Query de Primary Keys
        const pksSql = `
            SELECT
                TRIM(RC.RDB$RELATION_NAME) AS TABELA,
                TRIM(ISEG.RDB$FIELD_NAME) AS COLUNA
            FROM RDB$RELATION_CONSTRAINTS RC
            JOIN RDB$INDEX_SEGMENTS ISEG ON RC.RDB$INDEX_NAME = ISEG.RDB$INDEX_NAME
            WHERE RC.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY'
        `;

        console.log("📡 Consultando dicionário de dados...");
        
        // Executa as 3 queries em paralelo para performance
        const [columns, fks, pks] = await Promise.all([
            FirebirdDB.query<any>(columnsSql),
            FirebirdDB.query<any>(fksSql),
            FirebirdDB.query<any>(pksSql)
        ]);

        const dbStructure: Record<string, TableMetadata> = {};
        let identityFound = 0;

        // Passo 1: Mapear Colunas
        columns.forEach(row => {
            const table = row.TABELA;
            if (!dbStructure[table]) {
                dbStructure[table] = {
                    tabela: table,
                    colunas: []
                };
            }

            let cleanDefault = row.DEFAULT_VALUE;
            if (cleanDefault) {
                cleanDefault = cleanDefault.replace(/^DEFAULT\s+/i, '').trim();
            }

            if (row.IS_IDENTITY > 0) identityFound++;

            dbStructure[table].colunas.push({
                nome: row.COLUNA,
                tipo: row.TIPO_NOME.trim(),
                tamanho: row.TAMANHO,
                precisao: row.PRECISAO,
                escala: row.ESCALA,
                obrigatorio: row.REQUERIDO === 1,
                auto_increment: row.IS_IDENTITY > 0,
                default_value: cleanDefault || null,
                primary_key: false,
                fk: null
            });
        });

        // Passo 2: Marcar PKs
        pks.forEach(pk => {
            const table = dbStructure[pk.TABELA];
            if (table) {
                const col = table.colunas.find(c => c.nome === pk.COLUNA);
                if (col) col.primary_key = true;
            }
        });

        // Passo 3: Injetar FKs
        fks.forEach(fk => {
            const table = dbStructure[fk.TABELA_ORIGEM];
            if (table) {
                const col = table.colunas.find(c => c.nome === fk.COLUNA_ORIGEM);
                if (col) {
                    col.fk = {
                        referencia_tabela: fk.TABELA_DESTINO,
                        referencia_coluna: fk.COLUNA_DESTINO
                    };
                }
            }
        });

        // Gravação
        const outputPath = path.resolve(process.cwd(), 'db.json');
        fs.writeFileSync(outputPath, JSON.stringify(dbStructure, null, 2), 'utf-8');

        console.log("--------------------------------------------------");
        console.log(`✅ Extração concluída! Arquivo: ${outputPath}`);
        console.log(`📊 Tabelas processadas: ${Object.keys(dbStructure).length}`);
        console.log(`🆔 Campos Identity encontrados: ${identityFound}`);
        console.log("--------------------------------------------------");

    } catch (error) {
        console.error("❌ Falha crítica na geração do db.json:", error);
    } finally {
        // Encerra o processo para não deixar o pool aberto após o script terminar
        process.exit();
    }
}

exportMetadataToJson();