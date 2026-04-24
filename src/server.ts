import cors from 'cors';
import * as dotenv from 'dotenv';
import express from 'express';
import { OriusORM, OriusORMConfig } from './orm';

dotenv.config();

type RouteDefinition = {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    handler: (req: any, res: any) => Promise<void> | void;
};

function createOrmConfig(): OriusORMConfig | string {
    return OriusORM.configFromEnv(process.env);
}


async function bootstrap(): Promise<void> {
    const app = express();
    app.use(cors());
    app.use(express.json());

    const orm = new OriusORM(createOrmConfig());
    await orm.authenticate();

    app.get('/health', (_req, res) => {
        res.status(200).json({
            status: 'ok',
        });
    });

    const port = parseInt(process.env.PORT || '3000');
    const server = app.listen(port, () => {
        console.log(`🚀 API rodando em http://localhost:${port}`);
    });

    const shutdown = () => {
        server.close(() => {
            orm.close();
            process.exit(0);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
    console.error('❌ Falha ao iniciar servidor:', error);
    process.exit(1);
});
