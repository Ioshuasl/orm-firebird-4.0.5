export class ORMError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message);
        this.name = new.target.name;
    }
}

export class ValidationError extends ORMError {
    constructor(message: string, public readonly details: string[] = []) {
        super(message);
    }
}

export class DatabaseError extends ORMError {}
export class UniqueConstraintError extends DatabaseError {}
export class ForeignKeyConstraintError extends DatabaseError {}
export class ConnectionError extends DatabaseError {}
export class ConnectionRefusedError extends ConnectionError {}
export class ConnectionTimedOutError extends ConnectionError {}
export class ConnectionAcquireTimeoutError extends ConnectionError {}

export function mapDatabaseError(error: unknown): ORMError {
    if (error instanceof ORMError) return error;
    if (!(error instanceof Error)) return new DatabaseError('Unknown database error', error);

    const message = error.message || 'Database error';
    const lowered = message.toLowerCase();
    const code = ((error as any).code || '').toString().toLowerCase();

    if (lowered.includes('unique') || lowered.includes('violation of primary or unique key constraint')) {
        return new UniqueConstraintError(message, error);
    }

    if (lowered.includes('foreign key') || lowered.includes('violation of foreign key constraint')) {
        return new ForeignKeyConstraintError(message, error);
    }

    if (
        code === 'econnrefused' ||
        lowered.includes('connection refused') ||
        lowered.includes('actively refused')
    ) {
        return new ConnectionRefusedError(message, error);
    }

    if (
        code === 'etimedout' ||
        lowered.includes('timed out') ||
        lowered.includes('timeout')
    ) {
        return new ConnectionTimedOutError(message, error);
    }

    if (
        lowered.includes('acquire timeout') ||
        lowered.includes('failed to acquire connection') ||
        lowered.includes('falha ao obter conexão')
    ) {
        return new ConnectionAcquireTimeoutError(message, error);
    }

    return new DatabaseError(message, error);
}
