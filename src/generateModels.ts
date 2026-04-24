import * as fs from 'fs';
import * as path from 'path';

interface ColumnMetadata {
    nome: string;
    tipo: string;
    obrigatorio: boolean;
    auto_increment: boolean;
    default_value: string | null;
    primary_key: boolean;
    fk?: {
        referencia_tabela: string;
        referencia_coluna: string;
    } | null;
}

interface TableMetadata {
    tabela: string;
    colunas: ColumnMetadata[];
}

type DbMetadata = Record<string, TableMetadata>;

const DB_JSON_PATH = path.resolve(process.cwd(), 'db.json');
const OUTPUT_DIR = path.resolve(process.cwd(), 'src/models');
const LEGACY_OUTPUT_DIR = path.resolve(process.cwd(), 'src/models/generated');
const GENERATED_INDEX_PATH = path.resolve(OUTPUT_DIR, 'generated-index.ts');
const GENERATED_ASSOCIATIONS_PATH = path.resolve(OUTPUT_DIR, 'generated-associations.ts');

function toPascalCase(input: string): string {
    return input
        .toLowerCase()
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function classNameFromTable(tableName: string): string {
    // Mantém nome intuitivo igual ao da tabela (com sanitização mínima para TS).
    let className = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^\d/.test(className)) className = `TBL_${className}`;
    return className;
}

function mapDataType(columnType: string, columnName: string): string {
    const type = (columnType || '').toUpperCase();
    const name = (columnName || '').toUpperCase();

    if (type === 'VARCHAR' || type === 'CHAR') return 'DataType.STRING';
    if (type === 'SMALLINT' || type === 'INTEGER') return 'DataType.INTEGER';
    if (type === 'BIGINT') return 'DataType.BIGINT';
    if (type === 'DATE') return 'DataType.DATE';
    if (type === 'TIMESTAMP' || type === 'TIME') return 'DataType.TIMESTAMP';
    if (type === 'FLOAT' || type === 'DOUBLE') return 'DataType.DECIMAL';

    if (type === 'BLOB') {
        // db.json não traz subtipo do BLOB, então usamos heurística por nome da coluna.
        if (
            name.includes('ASSINAT') ||
            name.includes('FOTO') ||
            name.includes('IMAGEM') ||
            name.includes('ARQUIVO') ||
            name.includes('BINARY') ||
            name.includes('BIN')
        ) {
            return 'DataType.BINARY';
        }
        return 'DataType.TEXT';
    }

    return 'DataType.STRING';
}

function formatDefaultValue(rawDefault: string | null): string {
    if (rawDefault === null || rawDefault === undefined) return 'null';

    const trimmed = String(rawDefault).trim();
    if (trimmed.length === 0) return 'null';

    // Tenta preservar números/boolean simples
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    if (trimmed.toUpperCase() === 'TRUE') return 'true';
    if (trimmed.toUpperCase() === 'FALSE') return 'false';

    // Mantém expressão SQL como string para não quebrar parser TS
    return JSON.stringify(trimmed);
}

function buildModelFile(table: TableMetadata): string {
    const className = classNameFromTable(table.tabela);
    const primaryKeyColumn = table.colunas.find((c) => c.primary_key)?.nome || 'ID';

    const schemaLines = table.colunas.map((col) => {
        const parts: string[] = [`type: ${mapDataType(col.tipo, col.nome)}`];

        if (col.primary_key) parts.push('primaryKey: true');
        if (col.auto_increment) parts.push('autoIncrement: true');
        if (col.obrigatorio === false) parts.push('allowNull: true');
        if (col.default_value !== null) parts.push(`defaultValue: ${formatDefaultValue(col.default_value)}`);

        return `        ${col.nome}: { ${parts.join(', ')} }`;
    });

    return `import { Model } from '../orm/model';
import { DataType } from '../orm/data-types';

export class ${className} extends Model {
    protected static tableName = '${table.tabela}';
    protected static primaryKey = '${primaryKeyColumn}';

    protected static schema = {
${schemaLines.join(',\n')}
    };
}
`;
}

function buildIndexFile(generatedClasses: { fileName: string; className: string }[]): string {
    const imports = generatedClasses
        .map((item) => `export { ${item.className} } from './${item.fileName}';`)
        .join('\n');

    return `${imports}\n`;
}

type GeneratedAssociation = {
    sourceTable: string;
    sourceClass: string;
    targetTable: string;
    targetClass: string;
    foreignKey: string;
    targetKey: string;
    isOneToOne: boolean;
};

function isLikelyOneToOne(table: TableMetadata, fkColumnName: string): boolean {
    const fkCol = table.colunas.find((c) => c.nome === fkColumnName);
    if (!fkCol) return false;
    // Heurística: FK que também é PK tende a representar relação 1:1.
    return fkCol.primary_key;
}

function buildAssociationAlias(tableName: string): string {
    return tableName.toLowerCase();
}

function buildAssociationsFromMetadata(metadata: DbMetadata): GeneratedAssociation[] {
    const associations: GeneratedAssociation[] = [];

    for (const sourceTableName of Object.keys(metadata)) {
        const sourceTable = metadata[sourceTableName];
        if (!sourceTable || !Array.isArray(sourceTable.colunas)) continue;

        for (const col of sourceTable.colunas) {
            if (!col.fk) continue;

            const targetTableName = col.fk.referencia_tabela;
            const targetTable = metadata[targetTableName];
            if (!targetTable) continue;

            const targetPk = targetTable.colunas.find((c) => c.primary_key)?.nome || col.fk.referencia_coluna || 'ID';

            associations.push({
                sourceTable: sourceTable.tabela,
                sourceClass: classNameFromTable(sourceTable.tabela),
                targetTable: targetTable.tabela,
                targetClass: classNameFromTable(targetTable.tabela),
                foreignKey: col.nome,
                targetKey: targetPk,
                isOneToOne: isLikelyOneToOne(sourceTable, col.nome)
            });
        }
    }

    return associations;
}

function buildGeneratedAssociationsFile(
    generatedClasses: { fileName: string; className: string }[],
    associations: GeneratedAssociation[]
): string {
    const imports = generatedClasses
        .map((item) => `import { ${item.className} } from './${item.fileName}';`)
        .join('\n');

    const lines: string[] = [];

    for (const assoc of associations) {
        const belongsToAlias = buildAssociationAlias(assoc.targetTable);
        const reverseAlias = assoc.isOneToOne
            ? buildAssociationAlias(assoc.sourceTable)
            : `${buildAssociationAlias(assoc.sourceTable)}_list`;

        lines.push(
            `    ${assoc.sourceClass}.belongsTo(${assoc.targetClass}, { as: '${belongsToAlias}', foreignKey: '${assoc.foreignKey}', targetKey: '${assoc.targetKey}' });`
        );

        if (assoc.isOneToOne) {
            lines.push(
                `    ${assoc.targetClass}.hasOne(${assoc.sourceClass}, { as: '${reverseAlias}', foreignKey: '${assoc.foreignKey}', sourceKey: '${assoc.targetKey}' });`
            );
        } else {
            lines.push(
                `    ${assoc.targetClass}.hasMany(${assoc.sourceClass}, { as: '${reverseAlias}', foreignKey: '${assoc.foreignKey}', sourceKey: '${assoc.targetKey}' });`
            );
        }
    }

    return `${imports}

/**
 * Associações geradas automaticamente a partir das FKs do db.json.
 * Reexecute "npm run gen:models" após atualizar metadados.
 */
export function setupGeneratedAssociations(): void {
${lines.join('\n')}
}
`;
}

function ensureOutputDir(): void {
    // Remove pasta legada onde os models eram gerados anteriormente.
    if (fs.existsSync(LEGACY_OUTPUT_DIR)) {
        fs.rmSync(LEGACY_OUTPUT_DIR, { recursive: true, force: true });
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
}

function run(): void {
    try {
        if (!fs.existsSync(DB_JSON_PATH)) {
            throw new Error(`Arquivo não encontrado: ${DB_JSON_PATH}`);
        }

        const raw = fs.readFileSync(DB_JSON_PATH, 'utf-8');
        const metadata = JSON.parse(raw) as DbMetadata;

        ensureOutputDir();

        const generated: { fileName: string; className: string }[] = [];

        for (const tableName of Object.keys(metadata)) {
            const table = metadata[tableName];
            if (!table || !Array.isArray(table.colunas)) continue;

            const className = classNameFromTable(table.tabela);
            // Nome do arquivo deve refletir exatamente o tableName para facilitar navegação.
            const fileName = table.tabela;

            const fileContent = buildModelFile({
                ...table,
                tabela: table.tabela,
                colunas: table.colunas
            });

            fs.writeFileSync(path.join(OUTPUT_DIR, `${fileName}.ts`), fileContent, 'utf-8');
            generated.push({ fileName, className });
        }

        const generatedAssociations = buildAssociationsFromMetadata(metadata);

        fs.writeFileSync(GENERATED_INDEX_PATH, buildIndexFile(generated), 'utf-8');
        fs.writeFileSync(
            GENERATED_ASSOCIATIONS_PATH,
            buildGeneratedAssociationsFile(generated, generatedAssociations),
            'utf-8'
        );

        console.log('✅ Models gerados com sucesso.');
        console.log(`📁 Pasta: ${OUTPUT_DIR}`);
        console.log(`🧱 Total de models: ${generated.length}`);
        console.log('ℹ️ Arquivo de export gerado em src/models/generated-index.ts');
        console.log(`🔗 Associações geradas: ${generatedAssociations.length}`);
        console.log('ℹ️ Arquivo de associações gerado em src/models/generated-associations.ts');
    } catch (error) {
        console.error('❌ Falha ao gerar models:', error);
        process.exitCode = 1;
    }
}

run();
