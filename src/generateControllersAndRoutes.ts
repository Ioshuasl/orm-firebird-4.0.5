import * as fs from 'fs';
import * as path from 'path';

type ServiceInfo = {
    serviceClass: string;
    fileName: string;
    resourceName: string;
};

const SERVICES_DIR = path.resolve(process.cwd(), 'src/services');
const CONTROLLERS_DIR = path.resolve(process.cwd(), 'src/controllers');
const ROUTES_DIR = path.resolve(process.cwd(), 'src/routes');
const SERVICES_INDEX_PATH = path.resolve(SERVICES_DIR, 'generated-services-index.ts');
const CONTROLLERS_INDEX_PATH = path.resolve(CONTROLLERS_DIR, 'generated-controllers-index.ts');
const ROUTES_INDEX_PATH = path.resolve(ROUTES_DIR, 'generated-routes-index.ts');

function toKebabCase(input: string): string {
    return input
        .replace(/Service$/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase();
}

function parseServicesIndex(content: string): ServiceInfo[] {
    const lines = content.split(/\r?\n/);
    const regex = /^export\s+\{\s*([A-Za-z0-9_$]+)\s*\}\s+from\s+'\.\/(.+)';\s*$/;
    const services: ServiceInfo[] = [];

    for (const line of lines) {
        const match = line.match(regex);
        if (!match) continue;
        const serviceClass = match[1];
        const fileName = match[2];
        if (!serviceClass.endsWith('Service')) continue;

        services.push({
            serviceClass,
            fileName,
            resourceName: toKebabCase(serviceClass)
        });
    }

    return services;
}

function ensureDirs(): void {
    if (!fs.existsSync(CONTROLLERS_DIR)) fs.mkdirSync(CONTROLLERS_DIR, { recursive: true });
    if (!fs.existsSync(ROUTES_DIR)) fs.mkdirSync(ROUTES_DIR, { recursive: true });

    for (const file of fs.readdirSync(CONTROLLERS_DIR)) {
        if (file.endsWith('Controller.ts') || file === 'generated-controllers-index.ts') {
            fs.rmSync(path.join(CONTROLLERS_DIR, file), { force: true });
        }
    }

    for (const file of fs.readdirSync(ROUTES_DIR)) {
        if (file.endsWith('Routes.ts') || file === 'generated-routes-index.ts') {
            fs.rmSync(path.join(ROUTES_DIR, file), { force: true });
        }
    }
}

function buildControllerFile(serviceClass: string, serviceFile: string): string {
    const controllerClass = serviceClass.replace(/Service$/, 'Controller');

    return `import { ${serviceClass} } from '../services/${serviceFile}';

export class ${controllerClass} {
    public static async insert(req: any, res: any): Promise<void> {
        try {
            const created = await ${serviceClass}.insert(req.body || {});
            res.status(201).json(created.dataValues ?? created);
        } catch (error: any) {
            res.status(500).json({ message: 'Erro ao inserir registro', error: error?.message || error });
        }
    }

    public static async findAll(req: any, res: any): Promise<void> {
        try {
            const rows = await ${serviceClass}.findAll(req.query || {});
            res.status(200).json(rows.map((item: any) => item?.dataValues ?? item));
        } catch (error: any) {
            res.status(500).json({ message: 'Erro ao buscar registros', error: error?.message || error });
        }
    }

    public static async findByPk(req: any, res: any): Promise<void> {
        try {
            const row = await ${serviceClass}.findByPk(req.params?.id);
            if (!row) {
                res.status(404).json({ message: 'Registro não encontrado' });
                return;
            }
            res.status(200).json(row.dataValues ?? row);
        } catch (error: any) {
            res.status(500).json({ message: 'Erro ao buscar registro por ID', error: error?.message || error });
        }
    }

    public static async findOne(req: any, res: any): Promise<void> {
        try {
            const row = await ${serviceClass}.findOne({
                where: req.query || {}
            });
            if (!row) {
                res.status(404).json({ message: 'Registro não encontrado' });
                return;
            }
            res.status(200).json(row.dataValues ?? row);
        } catch (error: any) {
            res.status(500).json({ message: 'Erro ao buscar registro', error: error?.message || error });
        }
    }

    public static async update(req: any, res: any): Promise<void> {
        try {
            const updated = await ${serviceClass}.update(req.params?.id, req.body || {});
            if (!updated) {
                res.status(404).json({ message: 'Registro não encontrado para update' });
                return;
            }
            res.status(200).json(updated.dataValues ?? updated);
        } catch (error: any) {
            res.status(500).json({ message: 'Erro ao atualizar registro', error: error?.message || error });
        }
    }

    public static async delete(req: any, res: any): Promise<void> {
        try {
            const deleted = await ${serviceClass}.delete(req.params?.id);
            if (!deleted) {
                res.status(404).json({ message: 'Registro não encontrado para delete' });
                return;
            }
            res.status(204).send();
        } catch (error: any) {
            res.status(500).json({ message: 'Erro ao deletar registro', error: error?.message || error });
        }
    }
}
`;
}

function buildRoutesFile(controllerClass: string, resourceName: string): string {
    const factoryName = `get${controllerClass.replace(/Controller$/, '')}Routes`;

    return `import { ${controllerClass} } from '../controllers/${controllerClass}';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete';

export interface RouteDefinition {
    method: HttpMethod;
    path: string;
    handler: (req: any, res: any) => Promise<void> | void;
}

export function ${factoryName}(basePath: string = '/${resourceName}'): RouteDefinition[] {
    return [
        { method: 'post', path: \`\${basePath}\`, handler: ${controllerClass}.insert },
        { method: 'get', path: \`\${basePath}\`, handler: ${controllerClass}.findAll },
        { method: 'get', path: \`\${basePath}/find-one\`, handler: ${controllerClass}.findOne },
        { method: 'get', path: \`\${basePath}/:id\`, handler: ${controllerClass}.findByPk },
        { method: 'put', path: \`\${basePath}/:id\`, handler: ${controllerClass}.update },
        { method: 'delete', path: \`\${basePath}/:id\`, handler: ${controllerClass}.delete }
    ];
}
`;
}

function buildControllersIndex(controllers: string[]): string {
    return `${controllers.map((name) => `export { ${name} } from './${name}';`).join('\n')}\n`;
}

function buildRoutesIndex(routeFactories: string[]): string {
    return `${routeFactories.map((name) => `export { ${name} } from './${name.replace(/^get/, '').replace(/Routes$/, 'Routes')}';`).join('\n')}\n`;
}

function run(): void {
    try {
        if (!fs.existsSync(SERVICES_INDEX_PATH)) {
            throw new Error(`Arquivo não encontrado: ${SERVICES_INDEX_PATH}. Execute "npm run gen:services" antes.`);
        }

        const servicesContent = fs.readFileSync(SERVICES_INDEX_PATH, 'utf-8');
        const services = parseServicesIndex(servicesContent);
        if (services.length === 0) {
            throw new Error('Nenhum service encontrado em generated-services-index.ts');
        }

        ensureDirs();

        const controllers: string[] = [];
        const routeFactories: string[] = [];

        for (const service of services) {
            const controllerClass = service.serviceClass.replace(/Service$/, 'Controller');
            const routesFile = `${service.serviceClass.replace(/Service$/, 'Routes')}`;
            const routeFactoryName = `get${service.serviceClass.replace(/Service$/, '')}Routes`;

            fs.writeFileSync(
                path.join(CONTROLLERS_DIR, `${controllerClass}.ts`),
                buildControllerFile(service.serviceClass, service.fileName),
                'utf-8'
            );

            fs.writeFileSync(
                path.join(ROUTES_DIR, `${routesFile}.ts`),
                buildRoutesFile(controllerClass, service.resourceName),
                'utf-8'
            );

            controllers.push(controllerClass);
            routeFactories.push(routeFactoryName);
        }

        fs.writeFileSync(CONTROLLERS_INDEX_PATH, buildControllersIndex(controllers), 'utf-8');
        fs.writeFileSync(ROUTES_INDEX_PATH, buildRoutesIndex(routeFactories), 'utf-8');

        console.log('✅ Controllers e routes gerados com sucesso.');
        console.log(`🎛️ Controllers: ${controllers.length} em src/controllers`);
        console.log(`🛣️ Routes: ${routeFactories.length} em src/routes`);
        console.log('ℹ️ Índices: src/controllers/generated-controllers-index.ts e src/routes/generated-routes-index.ts');
    } catch (error) {
        console.error('❌ Falha ao gerar controllers/routes:', error);
        process.exitCode = 1;
    }
}

run();
