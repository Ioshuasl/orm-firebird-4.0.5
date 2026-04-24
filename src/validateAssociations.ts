import * as fs from 'fs';
import * as path from 'path';
import { FirebirdDB } from './database';

interface ColumnMetadata {
    nome: string;
    primary_key: boolean;
}

interface TableMetadata {
    tabela: string;
    colunas: ColumnMetadata[];
}

type DbMetadata = Record<string, TableMetadata>;

interface ForeignKeyRow {
    SOURCE_TABLE: string;
    SOURCE_COLUMN: string;
    TARGET_TABLE: string;
    TARGET_COLUMN: string;
    FK_NAME: string;
}

interface ParsedBelongsTo {
    sourceClass: string;
    targetClass: string;
    foreignKey: string;
    targetKey: string;
}

const DB_JSON_PATH = path.resolve(process.cwd(), 'db.json');
const GENERATED_ASSOCIATIONS_PATH = path.resolve(process.cwd(), 'src/models/generated-associations.ts');

function classNameFromTable(tableName: string): string {
    let className = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^\d/.test(className)) className = `TBL_${className}`;
    return className;
}

function normalize(value: string): string {
    return (value || '').trim().toUpperCase();
}

function makeKey(sourceTable: string, sourceColumn: string, targetTable: string, targetColumn: string): string {
    return `${normalize(sourceTable)}|${normalize(sourceColumn)}|${normalize(targetTable)}|${normalize(targetColumn)}`;
}

function loadClassTableMaps(metadata: DbMetadata): {
    classToTable: Map<string, string>;
    tableToClass: Map<string, string>;
} {
    const classToTable = new Map<string, string>();
    const tableToClass = new Map<string, string>();

    for (const tableName of Object.keys(metadata)) {
        const table = metadata[tableName];
        if (!table) continue;
        const className = classNameFromTable(table.tabela);
        classToTable.set(className, table.tabela);
        tableToClass.set(table.tabela, className);
    }

    return { classToTable, tableToClass };
}

function parseBelongsToCalls(content: string): ParsedBelongsTo[] {
    const regex = /([A-Za-z0-9_]+)\.belongsTo\(([A-Za-z0-9_]+),\s*\{\s*as:\s*'[^']*',\s*foreignKey:\s*'([^']+)',\s*targetKey:\s*'([^']+)'\s*\}\);/g;
    const matches: ParsedBelongsTo[] = [];

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        matches.push({
            sourceClass: match[1],
            targetClass: match[2],
            foreignKey: match[3],
            targetKey: match[4]
        });
    }

    return matches;
}

async function fetchForeignKeysFromDatabase(): Promise<ForeignKeyRow[]> {
    const sql = `
        SELECT
          TRIM(rc.RDB$RELATION_NAME)        AS SOURCE_TABLE,
          TRIM(iseg.RDB$FIELD_NAME)         AS SOURCE_COLUMN,
          TRIM(rcref.RDB$RELATION_NAME)     AS TARGET_TABLE,
          TRIM(isegref.RDB$FIELD_NAME)      AS TARGET_COLUMN,
          TRIM(rc.RDB$CONSTRAINT_NAME)      AS FK_NAME
        FROM RDB$RELATION_CONSTRAINTS rc
        JOIN RDB$REF_CONSTRAINTS refc
          ON rc.RDB$CONSTRAINT_NAME = refc.RDB$CONSTRAINT_NAME
        JOIN RDB$RELATION_CONSTRAINTS rcref
          ON refc.RDB$CONST_NAME_UQ = rcref.RDB$CONSTRAINT_NAME
        JOIN RDB$INDEX_SEGMENTS iseg
          ON rc.RDB$INDEX_NAME = iseg.RDB$INDEX_NAME
        JOIN RDB$INDEX_SEGMENTS isegref
          ON rcref.RDB$INDEX_NAME = isegref.RDB$INDEX_NAME
        WHERE rc.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
        ORDER BY 1, 2
    `;

    return FirebirdDB.query<ForeignKeyRow>(sql);
}

function toSortedArray(set: Set<string>): string[] {
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

async function run(): Promise<void> {
    try {
        if (!fs.existsSync(DB_JSON_PATH)) {
            throw new Error(`Arquivo não encontrado: ${DB_JSON_PATH}`);
        }

        if (!fs.existsSync(GENERATED_ASSOCIATIONS_PATH)) {
            throw new Error(`Arquivo não encontrado: ${GENERATED_ASSOCIATIONS_PATH}`);
        }

        const rawMetadata = fs.readFileSync(DB_JSON_PATH, 'utf-8');
        const metadata = JSON.parse(rawMetadata) as DbMetadata;
        const { classToTable } = loadClassTableMaps(metadata);

        const dbRows = await fetchForeignKeysFromDatabase();
        const dbKeySet = new Set<string>(
            dbRows.map((row) => makeKey(row.SOURCE_TABLE, row.SOURCE_COLUMN, row.TARGET_TABLE, row.TARGET_COLUMN))
        );

        const associationsFile = fs.readFileSync(GENERATED_ASSOCIATIONS_PATH, 'utf-8');
        const parsedBelongsTo = parseBelongsToCalls(associationsFile);

        const generatedKeySet = new Set<string>();
        const unresolvedClassMappings: ParsedBelongsTo[] = [];

        for (const assoc of parsedBelongsTo) {
            const sourceTable = classToTable.get(assoc.sourceClass);
            const targetTable = classToTable.get(assoc.targetClass);

            if (!sourceTable || !targetTable) {
                unresolvedClassMappings.push(assoc);
                continue;
            }

            generatedKeySet.add(makeKey(sourceTable, assoc.foreignKey, targetTable, assoc.targetKey));
        }

        const missingInGenerated = toSortedArray(
            new Set([...dbKeySet].filter((key) => !generatedKeySet.has(key)))
        );
        const extraInGenerated = toSortedArray(
            new Set([...generatedKeySet].filter((key) => !dbKeySet.has(key)))
        );

        console.log('--------------------------------------------------');
        console.log('🔎 Validação de Associações (FK real x generated-associations)');
        console.log(`FKs retornadas pela query SQL: ${dbRows.length}`);
        console.log(`FKs únicas (source|column|target|column): ${dbKeySet.size}`);
        console.log(`belongsTo encontrados no arquivo: ${parsedBelongsTo.length}`);
        console.log(`belongsTo mapeados para tabela: ${generatedKeySet.size}`);
        console.log(`Classes não mapeadas no db.json: ${unresolvedClassMappings.length}`);
        console.log(`Faltando no generated-associations: ${missingInGenerated.length}`);
        console.log(`Extras no generated-associations: ${extraInGenerated.length}`);
        console.log('--------------------------------------------------');

        if (unresolvedClassMappings.length > 0) {
            console.log('\n⚠️ Classes sem mapeamento (primeiros 10):');
            unresolvedClassMappings.slice(0, 10).forEach((item) => {
                console.log(
                    `- ${item.sourceClass}.belongsTo(${item.targetClass}) FK=${item.foreignKey} targetKey=${item.targetKey}`
                );
            });
        }

        if (missingInGenerated.length > 0) {
            console.log('\n❌ FKs faltando no generated-associations (primeiras 20):');
            missingInGenerated.slice(0, 20).forEach((line) => console.log(`- ${line}`));
        }

        if (extraInGenerated.length > 0) {
            console.log('\n❌ FKs extras no generated-associations (primeiras 20):');
            extraInGenerated.slice(0, 20).forEach((line) => console.log(`- ${line}`));
        }

        if (missingInGenerated.length === 0 && extraInGenerated.length === 0 && unresolvedClassMappings.length === 0) {
            console.log('\n✅ Validação concluída: associações geradas estão consistentes com a query SQL.');
        } else {
            console.log('\n⚠️ Validação encontrou divergências.');
            process.exitCode = 1;
        }
    } catch (error) {
        console.error('❌ Falha ao validar associações:', error);
        process.exitCode = 1;
    }
}

run().finally(() => {
    process.exit(process.exitCode ?? 0);
});
