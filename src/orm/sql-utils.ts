const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function sanitizeIdentifier(identifier: string, label = 'identifier'): string {
    const trimmed = identifier.trim();
    if (!trimmed) {
        throw new Error(`Invalid ${label}: value is empty.`);
    }

    if (!IDENTIFIER_REGEX.test(trimmed)) {
        throw new Error(`Invalid ${label}: "${identifier}" contains unsafe characters.`);
    }

    return trimmed.toUpperCase();
}

export function sanitizeQualifiedIdentifier(identifier: string, label = 'identifier'): string {
    return identifier
        .split('.')
        .map((part) => sanitizeIdentifier(part, label))
        .join('.');
}

export function normalizeSortDirection(direction: string): 'ASC' | 'DESC' {
    const normalized = direction.toUpperCase();
    if (normalized !== 'ASC' && normalized !== 'DESC') {
        throw new Error(`Invalid sort direction "${direction}". Use ASC or DESC.`);
    }
    return normalized;
}
