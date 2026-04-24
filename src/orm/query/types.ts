// src/orm/query/types.ts

import type * as Firebird from 'node-firebird';
import type { AssociationDefinition } from '../associations';

export type ModelStatic = {
    tableName: string;
    schema?: Record<string, any>;
    primaryKey?: string;
} & (new (values?: any) => any);

export type TableInput = string | ModelStatic;

export interface IncludeOptions {
    association?: string;
    model?: ModelStatic; // Agora aceita o Model
    table?: string;      // Ou a string (legado/flexibilidade)
    as?: string;
    on?: [string, string];
    attributes?: string[];
    required?: boolean;
    where?: Record<string | symbol, any>;
    /**
     * Só `include` de `belongsToMany`: `WHERE` na tabela de junção (no JOIN e em `separate: true` via `Through.findAll`).
     */
    through?: { where?: Record<string | symbol, any> };
    include?: IncludeOptions[] | IncludeOptions;
    /**
     * Estilo Sequelize: hasMany (e belongsTo com subconsulta) vão em outra(s) `SELECT` com `IN (...)`,
     * evitando explosão de produto cartesiano. Aninhado funciona: cada `separate` vira busca com `IN`.
     */
    separate?: boolean;
    /**
     * Só com `on` e sem `belongsTo`/`hasMany` registrado: define a forma de ligar (o padrão é `hasMany`).
     * Use `belongsTo` p.ex. para `User` em `Post` com `on: ['USUARIO_ID','ID']` sem `registerAssociation`.
     */
    separateType?: 'hasMany' | 'hasOne' | 'belongsTo';
    /** Só efeito com `separate: true` (e tipicamente hasMany) — mapeia para o `findAll` filho. */
    limit?: number;
    offset?: number;
    order?: [string, 'ASC' | 'DESC'][];
}

export type ScopeMap = Record<string, QueryOptions | ((...args: any[]) => QueryOptions)>;

export interface QueryOptions {
    where?: Record<string | symbol, any>;
    limit?: number;
    offset?: number;
    order?: [string, 'ASC' | 'DESC'][];
    attributes?: string[];
    include?: IncludeOptions[] | IncludeOptions;
    transaction?: Firebird.Transaction;
    logging?: boolean | ((sql: string, timingMs?: number) => void);
    benchmark?: boolean;
    ignoreDefaultScope?: boolean;
}

export interface IncludeProjectionMeta {
    as: string;
    path: string[];
    sqlAlias: string;
    attributes: string[];
    type: 'single' | 'many';
    /**
     * Só com `type: 'many'`: chave alvo (tipicamente PK do filho) para deduplicar linhas do produto
     * cartesiano pós-`JOIN` (hasMany, belongsToMany).
     */
    dedupeBy?: string;
}

/**
 * Uma fase pós-`SELECT` principal: encher `pathToSource[...].<as>` com o resultado de
 * `Target.findAll` filtrada por `IN` (e includes aninhados reaproveitam o mesmo `findAll`).
 */
export type SeparateIncludePlan = {
    pathToSource: string[];
    as: string;
    association: AssociationDefinition | null;
    /** Clone do bloco de include (com `separate: true` e sub-`include`) */
    node: IncludeOptions;
    /** Model fonte (pai da associação) e alvo, quando ambos conhecidos. */
    sourceModel: ModelStatic;
    targetModel: ModelStatic;
    /**
     * Forma de ligar: hasMany = filtrar o alvo por FK in (chaves do pai);
     * belongsTo/hasOne = alvo.PK in (fks do lado fonte); inferido de `on`+schema se necessário.
     */
    linkKind: 'hasMany' | 'hasOne' | 'belongsTo' | 'belongsToMany';
};

export interface QueryResult {
    sql: string;
    params: any[];
    includeMeta?: IncludeProjectionMeta[];
    separatePlans?: SeparateIncludePlan[];
}