import { Connection } from './connection';
import { Model } from './model';

export class OriusORM {
    private connection: Connection;

    constructor(config: any) {
        this.connection = new Connection(config);
    }

    /**
     * Registra um modelo no ORM
     */
    public define(modelClass: typeof Model, tableName: string) {
        (modelClass as any).tableName = tableName;
        (modelClass as any).setConnection(this.connection);
        return modelClass;
    }
}

export { DataType } from './data-types';
export { Model } from './model';
export { Op } from './operators';