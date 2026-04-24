import * as dotenv from 'dotenv';
import { OriusORM } from './index';

dotenv.config();

export const orm = OriusORM.fromEnv(process.env);
