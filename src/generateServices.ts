import * as fs from 'fs';
import * as path from 'path';

type ModelExport = {
    className: string;
    fileName: string;
};

const MODELS_INDEX_PATH = path.resolve(process.cwd(), 'src/models/generated-index.ts');
const OUTPUT_DIR = path.resolve(process.cwd(), 'src/services');
const LEGACY_OUTPUT_DIR = path.resolve(process.cwd(), 'src/services/generated');
const OUTPUT_INDEX_PATH = path.join(OUTPUT_DIR, 'generated-services-index.ts');

function parseModelExports(content: string): ModelExport[] {
    const lines = content.split(/\r?\n/);
    const exports: ModelExport[] = [];

    const regex = /^export\s+\{\s*([A-Za-z0-9_$]+)\s*\}\s+from\s+'\.\/(.+)';\s*$/;

    for (const line of lines) {
        const match = line.match(regex);
        if (!match) continue;

        exports.push({
            className: match[1],
            fileName: match[2]
        });
    }

    return exports;
}

function buildServiceFile(modelClass: string, modelFile: string): string {
    const serviceClass = `${modelClass}Service`;

    return `import type * as Firebird from 'node-firebird';
import { ${modelClass} } from '../models/${modelFile}';
import type { QueryOptions } from '../orm/query-builder';

type WriteOptions = {
    transaction?: Firebird.Transaction;
};

export class ${serviceClass} {
    public static async insert(data: Record<string, any>, options: WriteOptions = {}): Promise<${modelClass}> {
        const entity = new ${modelClass}(data);
        await entity.save({ transaction: options.transaction });
        return entity;
    }

    public static async findAll(options: QueryOptions = {}): Promise<${modelClass}[]> {
        return ${modelClass}.findAll(options);
    }

    public static async findByPk(id: any, options: QueryOptions = {}): Promise<${modelClass} | null> {
        const pkField = (${modelClass} as any).primaryKey || 'ID';
        return ${modelClass}.findOne({
            ...options,
            where: {
                ...(options.where || {}),
                [pkField]: id
            }
        });
    }

    public static async findOne(options: QueryOptions = {}): Promise<${modelClass} | null> {
        return ${modelClass}.findOne(options);
    }

    public static async update(
        id: any,
        data: Record<string, any>,
        options: QueryOptions & WriteOptions = {}
    ): Promise<${modelClass} | null> {
        const entity = await this.findByPk(id, options);
        if (!entity) return null;

        entity.dataValues = {
            ...entity.dataValues,
            ...data
        };

        await entity.save({ transaction: options.transaction });
        return entity;
    }

    public static async delete(id: any, options: WriteOptions = {}): Promise<boolean> {
        const entity = await this.findByPk(id);
        if (!entity) return false;

        await entity.delete({ transaction: options.transaction });
        return true;
    }
}
`;
}

function buildServicesIndex(models: ModelExport[]): string {
    return `${models
        .map((m) => `export { ${m.className}Service } from './${m.className}Service';`)
        .join('\n')}\n`;
}

function ensureCleanOutputDir(): void {
    if (fs.existsSync(LEGACY_OUTPUT_DIR)) {
        fs.rmSync(LEGACY_OUTPUT_DIR, { recursive: true, force: true });
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Limpa somente arquivos gerados de service para não apagar scripts manuais.
    const existing = fs.readdirSync(OUTPUT_DIR);
    for (const file of existing) {
        if (file.endsWith('Service.ts') || file === 'generated-services-index.ts') {
            fs.rmSync(path.join(OUTPUT_DIR, file), { force: true });
        }
    }
}

function run(): void {
    try {
        if (!fs.existsSync(MODELS_INDEX_PATH)) {
            throw new Error(`Arquivo não encontrado: ${MODELS_INDEX_PATH}`);
        }

        const content = fs.readFileSync(MODELS_INDEX_PATH, 'utf-8');
        const models = parseModelExports(content);
        if (models.length === 0) {
            throw new Error('Nenhum model encontrado em src/models/generated-index.ts');
        }

        ensureCleanOutputDir();

        for (const model of models) {
            const serviceCode = buildServiceFile(model.className, model.fileName);
            fs.writeFileSync(path.join(OUTPUT_DIR, `${model.className}Service.ts`), serviceCode, 'utf-8');
        }

        fs.writeFileSync(OUTPUT_INDEX_PATH, buildServicesIndex(models), 'utf-8');

        console.log('✅ Services CRUD gerados com sucesso.');
        console.log(`📁 Pasta: ${OUTPUT_DIR}`);
        console.log(`🧱 Total de services: ${models.length}`);
        console.log('ℹ️ Índice gerado em src/services/generated-services-index.ts');
    } catch (error) {
        console.error('❌ Falha ao gerar services CRUD:', error);
        process.exitCode = 1;
    }
}

run();
