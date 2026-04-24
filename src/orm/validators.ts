import type { ColumnOptions, ValidatorFn } from './data-types';

/**
 * Nomes de validadores built-in no objeto `validate` (padrão próximo do Sequelize 6),
 * além de chaves cujo valor seja `ValidatorFn`.
 */
export const BUILTIN_VALIDATOR_NAMES = new Set(
    [
        'notEmpty',
        'isNull',
        'isIn',
        'notIn',
        'min',
        'max',
        'len',
        'isEmail',
        'isUrl',
        'isIP',
        'isUUID',
        'isDate',
        'isInt',
        'isFloat',
        'isDecimal',
        'isNumeric',
        'isAlpha',
        'isAlphanumeric',
        'matches',
        'contains',
        'notContains',
        'isAfter',
        'isBefore',
        'equals',
        'not'
    ].map((s) => s.toLowerCase())
);

export function isBuiltInValidatorKey(name: string): boolean {
    return BUILTIN_VALIDATOR_NAMES.has(name.toLowerCase());
}

type MsgSpec = { msg?: string; args?: any };

function unpack(spec: unknown): { msg?: string; value: any } {
    if (spec != null && typeof spec === 'object' && !Array.isArray(spec) && ('args' in spec || 'msg' in spec)) {
        const s = spec as MsgSpec;
        if ('args' in s) return { msg: s.msg, value: s.args };
    }
    return { value: spec };
}

const RE_EMAIL = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,63}$/i;
const RE_INT = /^-?\d+$/;
const RE_NUMERIC = /^-?\d+(\.\d+)?([eE][+\-]?\d+)?$/;
const RE_ALPHA = /^[A-Za-zÀ-ÿ\u0100-\uFFFF]+$/;
const RE_ALNUM = /^[0-9A-Za-zÀ-ÿ\u0100-\uFFFF]+$/;
const RE_IPV4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RE_UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toDate(x: any): Date | null {
    if (x instanceof Date) return isNaN(x.getTime()) ? null : x;
    if (x == null) return null;
    const d = new Date(x);
    return isNaN(d.getTime()) ? null : d;
}

function isBlankValue(v: any): boolean {
    if (v == null) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
}

/**
 * Sequelize: `isIn: [['A','B']]` ou `isIn: ['A', 'B']`.
 */
function parseAllowedList(v: any): any[] {
    if (v == null) return [];
    if (Array.isArray(v) && v.length > 0 && Array.isArray((v as any[])[0])) {
        return (v as any[])[0] as any[];
    }
    if (Array.isArray(v)) {
        return v;
    }
    return [v];
}

/**
 * Cria `ValidatorFn` a partir de um nome e spec (ex.: `true`, `5`, `[[a,b]]`, `{ args: [5], msg: '...' }`).
 */
export function buildBuiltinValidator(validatorName: string, spec: unknown, fieldKey: string): ValidatorFn {
    const name = validatorName.toLowerCase();
    const { msg, value: arg } = unpack(spec);

    if (name === 'not') {
        return (v: any) => runNotValidator(spec, v, fieldKey, msg);
    }

    return (value: any) => {
        if (name === 'notempty') {
            if (isBlankValue(value)) return (msg as string) || `${fieldKey} cannot be empty.`;
            return true;
        }
        if (name === 'isnull') {
            if (value !== null && value !== undefined) {
                return (msg as string) || `${fieldKey} must be null.`;
            }
            return true;
        }
        if (name === 'isin' || name === 'notin') {
            if (value === null || value === undefined) return true;
            const list = parseAllowedList(arg);
            const hit = list.some((x) => Object.is(x, value) || x === value);
            if (name === 'isin' && !hit) {
                return (msg as string) || `${fieldKey} is not a valid choice.`;
            }
            if (name === 'notin' && hit) {
                return (msg as string) || `${fieldKey} is not an allowed value.`;
            }
            return true;
        }
        if (name === 'min' || name === 'max') {
            if (value === null || value === undefined) {
                return true;
            }
            const n = Number(arg);
            if (name === 'min') {
                if (typeof value === 'number' && !isNaN(value) && value < n) {
                    return (msg as string) || `${fieldKey} must be >= ${n}.`;
                }
                if (typeof value === 'string' && value.length < n) {
                    return (msg as string) || `${fieldKey} is too short (min ${n}).`;
                }
                if (Array.isArray(value) && value.length < n) {
                    return (msg as string) || `${fieldKey} has too few elements.`;
                }
                if (value instanceof Date) {
                    const cmp = toDate(n);
                    if (cmp && value < cmp) {
                        return (msg as string) || `${fieldKey} is too early.`;
                    }
                }
            } else {
                if (typeof value === 'number' && !isNaN(value) && value > n) {
                    return (msg as string) || `${fieldKey} must be <= ${n}.`;
                }
                if (typeof value === 'string' && value.length > n) {
                    return (msg as string) || `${fieldKey} is too long (max ${n}).`;
                }
                if (Array.isArray(value) && value.length > n) {
                    return (msg as string) || `${fieldKey} has too many elements.`;
                }
                if (value instanceof Date) {
                    const cmp = toDate(n);
                    if (cmp && value > cmp) {
                        return (msg as string) || `${fieldKey} is too late.`;
                    }
                }
            }
            return true;
        }
        if (name === 'len') {
            if (value === null || value === undefined) {
                return true;
            }
            const pair =
                (Array.isArray(arg) && arg.length >= 2
                    ? arg
                    : (arg as any)?.args && Array.isArray((arg as any).args) && (arg as any).args.length >= 2
                      ? (arg as any).args
                      : null) as [number, number] | null;
            if (pair) {
                const a = Number(pair[0]);
                const b = Number(pair[1]);
                if (typeof value === 'string' || Array.isArray(value)) {
                    const l = (value as any).length;
                    if (l < a || l > b) {
                        return (
                            (msg as string) ||
                            `${fieldKey} must have between ${a} and ${b} ${
                                typeof value === 'string' ? 'characters' : 'items'
                            }.`
                        );
                    }
                }
            }
            return true;
        }
        if (value === null || value === undefined) {
            return true;
        }
        if (name === 'isemail' && (arg === true || arg == null)) {
            if (!RE_EMAIL.test(String(value))) {
                return (msg as string) || `${fieldKey} must be a valid email.`;
            }
            return true;
        }
        if (name === 'isurl' && (arg === true || arg == null || (typeof arg === 'object' && arg !== null))) {
            try {
                new URL(String(value));
            } catch {
                return (msg as string) || `${fieldKey} must be a valid URL.`;
            }
            if (arg && typeof arg === 'object' && (arg as any).requireTld) {
                const h = (() => {
                    try {
                        return new URL(String(value)).hostname;
                    } catch {
                        return '';
                    }
                })();
                if (!h || !h.includes('.')) {
                    return (msg as string) || `${fieldKey} must have a TLD.`;
                }
            }
            return true;
        }
        if (name === 'isip' && (arg === true || arg == null)) {
            if (!RE_IPV4.test(String(value))) {
                return (msg as string) || `${fieldKey} must be a valid IPv4.`;
            }
            return true;
        }
        if (name === 'isuuid') {
            const s = String(value);
            if (arg === 4) {
                if (!RE_UUID4.test(s)) {
                    return (msg as string) || `${fieldKey} must be a valid UUID v4.`;
                }
            } else {
                if (!RE_UUID.test(s)) {
                    return (msg as string) || `${fieldKey} must be a valid UUID.`;
                }
            }
            return true;
        }
        if (name === 'isdate' && (arg === true || arg == null)) {
            if (!toDate(value)) {
                return (msg as string) || `${fieldKey} must be a valid date.`;
            }
            return true;
        }
        if (name === 'isint') {
            if (arg && typeof arg === 'object' && (arg as any).min != null) {
                const n = Number(value);
                if (!Number.isInteger(n)) {
                    return (msg as string) || `${fieldKey} must be an integer.`;
                }
                if (n < (arg as any).min || n > (arg as any).max) {
                    return (msg as string) || `${fieldKey} is out of range.`;
                }
            } else {
                if (!RE_INT.test(String(value)) || !Number.isInteger(Number(value))) {
                    return (msg as string) || `${fieldKey} must be an integer.`;
                }
            }
            return true;
        }
        if (name === 'isfloat' || name === 'isdecimal') {
            if (!RE_NUMERIC.test(String(value)) || isNaN(Number(value))) {
                return (msg as string) || `${fieldKey} must be a number.`;
            }
            if (name === 'isfloat' && !Number.isFinite(Number(value))) {
                return (msg as string) || `${fieldKey} must be a finite number.`;
            }
            return true;
        }
        if (name === 'isnumeric') {
            if (!RE_NUMERIC.test(String(value))) {
                return (msg as string) || `${fieldKey} must be numeric.`;
            }
            return true;
        }
        if (name === 'isalpha' && (arg === true || arg == null)) {
            if (!RE_ALPHA.test(String(value))) {
                return (msg as string) || `${fieldKey} may only contain letters.`;
            }
            return true;
        }
        if (name === 'isalphanumeric' && (arg === true || arg == null)) {
            if (!RE_ALNUM.test(String(value))) {
                return (msg as string) || `${fieldKey} may only contain letters and numbers.`;
            }
            return true;
        }
        if (name === 'matches') {
            let re: RegExp;
            if (arg instanceof RegExp) re = arg;
            else if (Array.isArray(arg) && arg[0] != null) {
                re = new RegExp(String(arg[0]), arg[1] != null ? String(arg[1]) : '');
            } else {
                re = new RegExp(String(arg));
            }
            if (!re.test(String(value))) {
                return (msg as string) || `${fieldKey} has an invalid format.`;
            }
            return true;
        }
        if (name === 'contains' && (typeof arg === 'string' || typeof arg === 'number')) {
            if (!String(value).includes(String(arg))) {
                return (msg as string) || `${fieldKey} must contain the required value.`;
            }
            return true;
        }
        if (name === 'notcontains' && (typeof arg === 'string' || typeof arg === 'number')) {
            if (String(value).includes(String(arg))) {
                return (msg as string) || `${fieldKey} may not contain the forbidden value.`;
            }
            return true;
        }
        if (name === 'isafter' || name === 'isbefore') {
            const a = toDate(value);
            const b = toDate(arg);
            if (!a) {
                return (msg as string) || `${fieldKey} is not a valid date.`;
            }
            if (b) {
                if (name === 'isafter' && !(a.getTime() > b.getTime())) {
                    return (msg as string) || `${fieldKey} is not after the limit.`;
                }
                if (name === 'isbefore' && !(a.getTime() < b.getTime())) {
                    return (msg as string) || `${fieldKey} is not before the limit.`;
                }
            }
            return true;
        }
        if (name === 'equals') {
            if (value !== arg) {
                return (msg as string) || `${fieldKey} has an invalid value.`;
            }
            return true;
        }
        return true;
    };
}

/**
 * O subvalidador (positivo) passou a true ⇒ `not` falha. Falha do sub (string/false) ⇒ `not` ok.
 */
function runNotValidator(spec: any, value: any, fieldKey: string, msg: string | undefined): boolean | string {
    const inner = spec?.not;
    if (typeof inner === 'function') {
        const r = inner(value) as any;
        if (r === true) {
            return msg || `${fieldKey} is invalid.`;
        }
        return true;
    }
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        for (const [k, v] of Object.entries(inner as Record<string, any>)) {
            if (isBuiltInValidatorKey(k) && typeof v !== 'function') {
                const r = buildBuiltinValidator(k, v, fieldKey)(value) as any;
                if (r === true) {
                    return msg || `${fieldKey} is invalid.`;
                }
                if (typeof r === 'string' || r === false) {
                    continue;
                }
            } else if (typeof v === 'function') {
                const r = (v as ValidatorFn)(value) as any;
                if (r === true) {
                    return msg || `${fieldKey} is invalid.`;
                }
            }
        }
    }
    return true;
}

/**
 * Aplica um par do objeto `validate`: built-in, função, ou `not: { ... }`.
 */
export async function runValidateEntry(
    key: string,
    validatorName: string,
    spec: unknown,
    value: any,
    _column: ColumnOptions
): Promise<boolean | string> {
    if (validatorName.toLowerCase() === 'not' && spec != null && typeof spec === 'object' && 'not' in (spec as any)) {
        return runNotValidator(spec, value, key, (spec as any).msg);
    }
    if (isBuiltInValidatorKey(validatorName) && typeof spec !== 'function') {
        return buildBuiltinValidator(validatorName, spec, key)(value) as any;
    }
    if (typeof spec === 'function') {
        return (await (spec as ValidatorFn)(value)) as any;
    }
    return `${key}: invalid validate entry "${validatorName}" (expected built-in or function)`;
}
