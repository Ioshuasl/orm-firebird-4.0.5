# ORM Firebird Node.js (Sequelize-like)

ORM em TypeScript para Firebird com API inspirada no Sequelize: modelos orientados a classe, operadores com `Op`, `include`, transações, hooks, scopes e validação.

## Principais recursos implementados

Esta secao resume, em linguagem simples, o que o ORM ja faz por voce para reduzir codigo manual de SQL, organizando conexao, modelos e consultas em uma API unica.

- Inicialização flexível (`new OriusORM`, `from`, `fromEnv`) com config por objeto, DSN ou URL.
- Pool de conexões com validação antes do reuso (`validateConnection` interno).
- API de Model estilo Sequelize (`findAll/findOne/findByPk/count/create/update/destroy/save/reload`).
- Operadores com `Op` (`and/or/in/notIn/between/notBetween/is/not/...`).
- Associações (`belongsTo`, `hasOne`, `hasMany`, `belongsToMany`) e mixins automáticos.
- `include` com materialização aninhada e suporte a `separate: true`.
- Hooks globais e por model; validação com built-ins e custom.
- Transações com commit/rollback automático e suporte a savepoint.
- `QueryInterface` com introspecção de metadata e API incremental de DDL.

## Instalação e bootstrap

Aqui voce prepara o projeto e abre a primeira conexao com o banco. Em outras palavras, e o "ligar o motor" da aplicacao antes de usar os models.

```bash
npm install
```

```ts
import { OriusORM } from './src/orm';

const orm = new OriusORM({
  host: '127.0.0.1',
  port: 3050,
  databaseAlias: 'IOSHUA',
  user: 'SYSDBA',
  password: 'masterkey',
  encoding: 'UTF8',
  maxPool: 10,
  logging: true,
  benchmark: true
});

await orm.authenticate();
// Resposta esperada: valida a conexao com o banco sem erro (se falhar, lanca excecao).
```

```sql
-- SQL equivalente (Firebird): teste simples de conectividade
SELECT 1 AS OK FROM RDB$DATABASE;
```

Também é possível usar `connectionString` no formato `host/port:databaseAlias`.

## Definição de modelos

Modelos sao classes que representam tabelas do banco. Eles ajudam o usuario a trabalhar com objetos no codigo em vez de montar SQL manual para cada operacao.

### Estilo classe com `static schema` (compatível)

Este formato e util quando voce quer manter o schema da tabela declarado diretamente na classe, de forma explicita e facil de ler.

```ts
import { Model, DataType } from './src/orm';

export class T_ATO extends Model {
  protected static tableName = 'T_ATO';
  protected static primaryKey = 'ATO_ID';
  protected static schema = {
    ATO_ID: { type: DataType.BIGINT, primaryKey: true, autoIncrement: true, sequence: 'GEN_T_ATO' },
    PROTOCOLO: { type: DataType.INTEGER, allowNull: false },
    OBSERVACAO: { type: DataType.TEXT },
    ATIVO: { type: DataType.STRING, defaultValue: 'A' }
  };
}
```

### Estilo `Model.init` (mais próximo do Sequelize)

Este formato segue o estilo mais conhecido por quem ja usa Sequelize, facilitando migracao e onboarding do time.

```ts
import { Model, DataTypes } from './src/orm';

export class Usuario extends Model {}

Usuario.init(
  {
    USUARIO_ID: { type: DataTypes.BIGINT(), primaryKey: true, autoIncrement: true, sequence: 'GEN_G_USUARIO' },
    LOGIN: { type: DataTypes.STRING(60), allowNull: false },
    NOME_COMPLETO: { type: DataTypes.STRING(150), allowNull: false },
    PERFIL: { type: DataTypes.ENUM('admin', 'operador', 'consulta'), allowNull: false }
  },
  {
    tableName: 'G_USUARIO',
    primaryKey: 'USUARIO_ID',
    timestamps: true
  }
);
```

### Estilo `orm.define(...)` (caso real do projeto)

Este formato e muito util quando voce quer definir e registrar o model em uma linha, especialmente em arquivos de catalogo de modelos. No projeto, `src/models/T_ATO.ts` segue esse padrao.

```ts
import { DataType } from './src/orm/data-types';
import { orm } from './src/orm/client';
import { G_USUARIO } from './src/models/G_USUARIO';

const T_ATO_ATTRIBUTES = {
  ATO_ID: { type: DataType.BIGINT, primaryKey: true, autoIncrement: true },
  PROTOCOLO: { type: DataType.BIGINT },
  USUARIO_ID: {
    type: DataType.BIGINT,
    references: { model: G_USUARIO, key: 'USUARIO_ID' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL'
  },
  OBSERVACAO: { type: DataType.STRING }
};

export const T_ATO = orm.define('T_ATO', T_ATO_ATTRIBUTES, {
  modelName: 'T_ATO',
  tableName: 'T_ATO',
  primaryKey: 'ATO_ID'
});
// Resposta esperada: model "T_ATO" registrado e pronto para consultas/CRUD.
```

```sql
-- SQL equivalente (conceitual): definicao de schema/tabela
-- (No SQL puro voce precisa criar tabela/constraints manualmente)
CREATE TABLE T_ATO (...);
```

## DataTypes, references e validação de atributos

Esta secao explica, em linguagem simples, como definir o "tipo de cada coluna", como ligar tabelas com `references` e como validar dados antes de salvar. Pense nisso como um formulario com regras: cada campo tem formato, obrigatoriedade e relacoes.

### Quando usar `DataType` e quando usar `DataTypes`

- Use `DataType.X` quando quiser uma forma direta e curta (sem parametros), por exemplo `DataType.BIGINT`.
- Use `DataTypes.X(...)` quando precisar configurar detalhes, como tamanho (`STRING(120)`) ou precisao (`DECIMAL(18, 2)`).

Caso de uso: cadastro de cliente com nome limitado, email obrigatorio e valor monetario.

```ts
import { DataTypes } from './src/orm';

const Cliente = orm.define(
  'Cliente',
  {
    ID: { type: DataTypes.BIGINT(), primaryKey: true, autoIncrement: true }, // Identificador unico
    NOME: { type: DataTypes.STRING(120), allowNull: false }, // Texto curto com limite de tamanho
    EMAIL: { type: DataTypes.STRING(150), allowNull: false }, // Email textual
    LIMITE_CREDITO: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 } // Numero com casas decimais
  },
  { tableName: 'G_CLIENTE', primaryKey: 'ID' }
);
// Resposta esperada: model criado com tipos corretos e regras basicas de null/default.
```

```sql
-- SQL equivalente (resumo)
CREATE TABLE G_CLIENTE (
  ID BIGINT NOT NULL PRIMARY KEY,
  NOME VARCHAR(120) NOT NULL,
  EMAIL VARCHAR(150) NOT NULL,
  LIMITE_CREDITO DECIMAL(18,2) DEFAULT 0
);
```

### Guia rapido dos DataTypes mais usados (com exemplo real)

Caso de uso: model de "pedido" com datas, valores, texto longo e indicador logico.

```ts
const Pedido = orm.define(
  'Pedido',
  {
    ID: { type: DataType.BIGINT, primaryKey: true, autoIncrement: true }, // Numero inteiro grande
    NUMERO: { type: DataType.INTEGER }, // Numero inteiro comum
    CODIGO_CURTO: { type: DataType.CHAR }, // Texto curto fixo (ex.: "A", "B")
    DESCRICAO: { type: DataType.STRING }, // Texto curto variavel
    OBSERVACAO_LONGA: { type: DataType.TEXT }, // Texto longo
    ARQUIVO_ASSINATURA: { type: DataType.BINARY }, // Conteudo binario (assinatura/imagem)
    VALOR_TOTAL: { type: DataType.DECIMAL }, // Valor monetario
    EH_URGENTE: { type: DataType.BOOLEAN, defaultValue: false }, // Sim/nao
    DATA_PEDIDO: { type: DataType.DATE }, // Apenas data
    HORA_PEDIDO: { type: DataType.TIME }, // Apenas hora
    CRIADO_EM: { type: DataType.TIMESTAMP } // Data e hora completas
  },
  { tableName: 'T_PEDIDO', primaryKey: 'ID' }
);
// Resposta esperada: cada coluna e criada com semantica de tipo adequada ao dado de negocio.
```

```sql
-- SQL equivalente (resumo)
CREATE TABLE T_PEDIDO (
  ID BIGINT NOT NULL PRIMARY KEY,
  NUMERO INTEGER,
  CODIGO_CURTO CHAR(1),
  DESCRICAO VARCHAR(255),
  OBSERVACAO_LONGA BLOB SUB_TYPE TEXT,
  ARQUIVO_ASSINATURA BLOB,
  VALOR_TOTAL DECIMAL(18,2),
  EH_URGENTE BOOLEAN DEFAULT FALSE,
  DATA_PEDIDO DATE,
  HORA_PEDIDO TIME,
  CRIADO_EM TIMESTAMP
);
```

### `references`: como ligar uma tabela a outra (chave estrangeira)

`references` cria uma ligacao entre tabelas, como "este pedido pertence a um usuario". Isso ajuda o banco a manter consistencia dos dados automaticamente.

Voce pode referenciar de duas formas (flexivel, estilo Sequelize):

```ts
// Forma 1: por string (nome do model/tabela)
USUARIO_ID: {
  type: DataType.BIGINT,
  references: { model: 'G_USUARIO', key: 'USUARIO_ID' }, // Liga com a PK da tabela de usuario
  onUpdate: 'CASCADE', // Se a PK mudar, atualiza aqui tambem
  onDelete: 'SET NULL' // Se usuario for removido, este campo vira null
}
// Resposta esperada: FK valida apontando para G_USUARIO.USUARIO_ID.
```

```sql
-- SQL equivalente (resumo)
ALTER TABLE T_ATO
ADD CONSTRAINT FK_ATO_USUARIO
FOREIGN KEY (USUARIO_ID)
REFERENCES G_USUARIO (USUARIO_ID)
ON UPDATE CASCADE
ON DELETE SET NULL;
```

```ts
import { G_USUARIO } from './src/models/G_USUARIO';

// Forma 2: usando o proprio model importado
USUARIO_ID: {
  type: DataType.BIGINT,
  references: { model: G_USUARIO, key: 'USUARIO_ID' }, // Mesmo resultado, com mais seguranca de refatoracao
  onUpdate: 'CASCADE',
  onDelete: 'SET NULL'
}
// Resposta esperada: mesma FK, agora referenciada por model/classe.
```

```sql
-- SQL equivalente: identico ao bloco anterior (FK e a mesma no banco)
ALTER TABLE T_ATO
ADD CONSTRAINT FK_ATO_USUARIO
FOREIGN KEY (USUARIO_ID)
REFERENCES G_USUARIO (USUARIO_ID);
```

### Schema de validação de atributos (`validate`)

A validacao evita salvar dados invalidos. Para leigos: e como checar um formulario antes de clicar em "Enviar".

Caso de uso: impedir login curto, email invalido e idade fora de faixa.

```ts
const Usuario = orm.define(
  'Usuario',
  {
    ID: { type: DataTypes.BIGINT(), primaryKey: true, autoIncrement: true },
    LOGIN: {
      type: DataTypes.STRING(60),
      allowNull: false,
      validate: {
        len: [3, 60] // Built-in: minimo 3, maximo 60 caracteres
      }
    },
    EMAIL: {
      type: DataTypes.STRING(150),
      allowNull: false,
      validate: {
        isEmail: true // Built-in: formato de email valido
      }
    },
    IDADE: {
      type: DataTypes.INTEGER(),
      validate: {
        min: 18, // Built-in: idade minima
        max: 120 // Built-in: idade maxima
      }
    },
    CPF: {
      type: DataTypes.STRING(14),
      validate: {
        // Custom validator: sua regra de negocio personalizada
        formatoCpf: (value) => /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(String(value || '')) || 'CPF invalido'
      }
    }
  },
  { tableName: 'G_USUARIO', primaryKey: 'ID' }
);
// Resposta esperada: em `create/save/update`, dados invalidos geram ValidationError com detalhes.
```

```sql
-- SQL puro nao cobre todas as validacoes de negocio facilmente.
-- Parte estrutural:
CREATE TABLE G_USUARIO (...);
-- Regras como isEmail/len/min/max normalmente exigem CHECKs complexos,
-- triggers ou validacao na aplicacao.
```

### Configurações essenciais de coluna (primaryKey, autoIncrement, allowNull, defaultValue, sequence)

Essas configuracoes definem o comportamento do campo no banco e evitam regras espalhadas pelo codigo. Para leigos: e como preencher as "regras do formulario" de cada coluna.

Caso de uso: tabela de pedidos onde o ID e gerado automaticamente, status com valor padrao e data obrigatoria.

```ts
const Pedido = orm.define(
  'Pedido',
  {
    ID: {
      type: DataType.BIGINT,
      primaryKey: true, // Diz que este campo e a chave principal (identificador unico)
      autoIncrement: true, // Pede para o ORM gerar o proximo valor automaticamente
      sequence: 'GEN_T_PEDIDO' // Nome da sequence/generator usada no Firebird (quando aplicavel)
    },
    STATUS: {
      type: DataType.STRING,
      allowNull: false, // Campo obrigatorio: nao aceita vazio/null
      defaultValue: 'ABERTO' // Se nao informar, grava automaticamente "ABERTO"
    },
    CRIADO_EM: {
      type: DataType.TIMESTAMP,
      allowNull: false // Exige data/hora de criacao
    }
  },
  {
    tableName: 'T_PEDIDO',
    primaryKey: 'ID'
  }
);
// Resposta esperada: `ID` unico e auto-gerado; `STATUS` recebe padrao quando ausente; campos obrigatorios bloqueiam null.
```

```sql
-- SQL equivalente (resumo)
CREATE TABLE T_PEDIDO (
  ID BIGINT NOT NULL PRIMARY KEY,
  STATUS VARCHAR(255) NOT NULL DEFAULT 'ABERTO',
  CRIADO_EM TIMESTAMP NOT NULL
);
```

O que cada propriedade faz na pratica:

- `primaryKey`: marca a coluna principal usada para identificar cada linha.
- `autoIncrement`: tenta gerar automaticamente o proximo ID em inserts.
- `allowNull`: controla se o campo pode ficar vazio (`true`) ou e obrigatorio (`false`).
- `defaultValue`: valor padrao aplicado quando o usuario nao envia valor.
- `sequence`: nome do generator/sequence no Firebird para estrategias de incremento em bancos legados.

### Resumo prático para leigos

- `type`: define o formato do campo (texto, numero, data, binario).
- `allowNull`: diz se pode ficar vazio.
- `defaultValue`: valor automatico quando nada for enviado.
- `references`: liga uma tabela em outra (integridade referencial).
- `validate`: regras para bloquear dado invalido antes de gravar no banco.

## Registro de modelos

Registrar modelos conecta as classes ao ORM ativo, permitindo consultas, associacoes, hooks e sync no contexto da conexao atual.

```ts
orm.define(T_ATO, 'T_ATO');
orm.define(Usuario, 'G_USUARIO');
// Resposta esperada: ambos os models ficam vinculados ao ORM ativo.
```

```sql
-- SQL equivalente: nao existe comando unico para "registrar model".
-- Em SQL puro, voce consulta/atualiza tabelas diretamente em cada rotina.
```

Também é suportado o `define` no estilo Sequelize (`nome + atributos + opções`) para casos de model dinâmico:

```ts
const Auditoria = orm.define(
  'Auditoria',
  {
    AUDITORIA_ID: { type: DataTypes.BIGINT(), primaryKey: true, autoIncrement: true, sequence: 'GEN_AUDITORIA' },
    ACAO: { type: DataTypes.STRING(60), allowNull: false },
    CRIADO_EM: { type: DataTypes.DATE(), allowNull: false }
  },
  {
    tableName: 'T_AUDITORIA',
    timestamps: false
  }
);

await Auditoria.create({ ACAO: 'LOGIN', CRIADO_EM: new Date() });
// Resposta esperada: retorna a instancia criada com os dados persistidos.
```

```sql
INSERT INTO T_AUDITORIA (ACAO, CRIADO_EM)
VALUES ('LOGIN', CURRENT_TIMESTAMP)
RETURNING AUDITORIA_ID;
```

## CRUD (API estilo Sequelize)

CRUD significa criar, ler, atualizar e excluir dados. Esta API cobre o ciclo diario de manipulacao de registros com metodos intuitivos.

```ts
const created = await T_ATO.create({
  PROTOCOLO: 9999,
  ATIVO: 'A'
});

created.set('OBSERVACAO', 'Atualizado via ORM');
await created.save();

const [affected, rows] = await T_ATO.update(
  { ATIVO: 'I' },
  { where: { PROTOCOLO: 9999 } }
);

const deleted = await T_ATO.destroy({
  where: { PROTOCOLO: 9999 }
});
// Resposta esperada: `created` = instancia criada, `affected` = qtd atualizada, `deleted` = qtd removida.
```

```sql
-- Equivalentes SQL (resumo)
INSERT INTO T_ATO (PROTOCOLO, ATIVO) VALUES (9999, 'A') RETURNING ATO_ID;
UPDATE T_ATO SET ATIVO = 'I' WHERE PROTOCOLO = 9999;
DELETE FROM T_ATO WHERE PROTOCOLO = 9999;
```

### `count()` e `findAndCountAll()` (paginação e totais)

Essas funcoes sao muito uteis quando voce precisa mostrar listas paginadas na tela.  
Em linguagem simples:
- `count()` responde "quantos registros existem com esse filtro?"
- `findAndCountAll()` responde "quantos existem no total" + "quais registros da pagina atual"

Caso de uso: tela de listagem de atos e usuarios com pagina de 5 itens.

```ts
const totalAtos = await T_ATO.count({
  where: { SITUACAO_ATO: '1' }
});

const atosPaginados = await T_ATO.findAndCountAll({
  where: { SITUACAO_ATO: '1' },
  order: [['ATO_ID', 'DESC']],
  limit: 5,
  offset: 0
});

const usuariosPaginados = await G_USUARIO.findAndCountAll({
  order: [['USUARIO_ID', 'DESC']],
  limit: 5,
  offset: 0
});

console.log('Total de atos ativos:', totalAtos);
console.log('Atos (count + rows):', {
  count: atosPaginados.count, // total geral sem limitar
  rows: atosPaginados.rows // somente os 5 da pagina
});
console.log('Usuarios (count + rows):', {
  count: usuariosPaginados.count,
  rows: usuariosPaginados.rows
});
// Resposta esperada:
// - `count()` retorna um numero.
// - `findAndCountAll()` retorna { count, rows }.
// - `count` representa o total completo do filtro.
// - `rows` representa apenas a pagina (`limit/offset`).
```

```sql
-- SQL equivalente para count()
SELECT COUNT(*) AS TOTAL
FROM T_ATO
WHERE SITUACAO_ATO = '1';

-- SQL equivalente para findAndCountAll() (normalmente 2 queries)
SELECT COUNT(*) AS TOTAL
FROM T_ATO
WHERE SITUACAO_ATO = '1';

SELECT *
FROM T_ATO
WHERE SITUACAO_ATO = '1'
ORDER BY ATO_ID DESC
ROWS 5;

-- Outro exemplo (usuarios)
SELECT COUNT(*) AS TOTAL FROM G_USUARIO;
SELECT * FROM G_USUARIO ORDER BY USUARIO_ID DESC ROWS 5;
```

### `findByPk` (casos de uso)

`findByPk` busca um registro pela chave primaria. Isso evita erros comuns de `where` manual e deixa consultas pontuais mais claras.

```ts
// PK simples
const ato = await T_ATO.findByPk(1000);

// PK composta por objeto
const item = await ItemComposto.findByPk({ EMPRESA_ID: 1, ITEM_ID: 10 });

// PK composta por array (na ordem da chave)
const item2 = await ItemComposto.findByPk([1, 10]);
// Resposta esperada: retorna a instancia encontrada ou `null` quando nao existe.
```

```sql
-- PK simples
SELECT * FROM T_ATO WHERE ATO_ID = 1000 ROWS 1;
-- PK composta
SELECT * FROM ITEM_COMPOSTO WHERE EMPRESA_ID = 1 AND ITEM_ID = 10 ROWS 1;
```

### Métodos de instância relevantes

Esses metodos ajudam a entender o estado atual do objeto em memoria e a persistir mudancas de forma segura.

- `isNewRecord`: informa se o objeto ainda nao existe no banco (`true`) ou se ja veio de uma consulta (`false`).
  - Caso de uso: mostrar no fluxo da tela se voce deve criar um registro novo ou apenas atualizar um existente.
- `changed()` / `changed('CAMPO')`: mostra se houve alteracao desde o ultimo carregamento/salvamento.
  - Caso de uso: antes de salvar, checar se algo realmente mudou para evitar update desnecessario.
- `previous()` / `previous('CAMPO')`: retorna o valor antigo, antes da mudanca atual.
  - Caso de uso: auditoria simples, como registrar "status antigo -> status novo" no log de negocio.
- `save()`: grava no banco as alteracoes feitas no objeto atual.
  - Caso de uso: editar alguns campos em memoria e chamar `save()` uma unica vez para persistir tudo.
- `destroy()` (`delete()` segue disponível como compat layer): remove o registro atual do banco.
  - Caso de uso: excluir um item da tela de administracao sem montar SQL manual de `DELETE`.

Exemplo rapido juntando esses metodos:

```ts
const ato = await T_ATO.findByPk(1000);
if (!ato) return;

console.log('Ja existe no banco?', !ato.isNewRecord);

ato.set('OBSERVACAO', 'Atualizado pelo painel');
if (ato.changed('OBSERVACAO')) {
  console.log('Valor anterior:', ato.previous('OBSERVACAO'));
  await ato.save();
  // Resposta esperada: atualiza o registro no banco com a nova observacao.
}

// Em um fluxo de exclusao:
// await ato.destroy();
// Resposta esperada: remove o registro atual quando `destroy()` for executado.
```

## Consultas e operadores

Nesta secao, voce combina filtros de forma declarativa com `Op`, criando buscas simples ou complexas sem escrever SQL direto.

```ts
import { Op } from './src/orm';

const rows = await T_ATO.findAll({
  where: {
    [Op.or]: [
      { SITUACAO_ATO: '1' },
      { SITUACAO_ATO: '2' }
    ],
    ATO_ID: { [Op.between]: [1000, 2000] },
    PROTOCOLO: { [Op.notIn]: [10, 20, 30] }
  },
  order: [['ATO_ID', 'DESC']],
  limit: 50,
  offset: 0
});
// Resposta esperada: lista de registros filtrados conforme `where/order/limit/offset`.
```

```sql
SELECT *
FROM T_ATO
WHERE (SITUACAO_ATO = '1' OR SITUACAO_ATO = '2')
  AND ATO_ID BETWEEN 1000 AND 2000
  AND PROTOCOLO NOT IN (10, 20, 30)
ORDER BY ATO_ID DESC
ROWS 50;
```

Operadores suportados: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `notLike`, `in`, `notIn`, `between`, `notBetween`, `and`, `or`, `is`, `not`.

## Associações e include

Associacoes ligam tabelas relacionadas (como usuario e ato). Com `include`, o ORM monta os joins e devolve os dados aninhados para facilitar o consumo.

```ts
T_ATO.belongsTo(Usuario, {
  as: 'usuario',
  foreignKey: 'USUARIO_ID',
  targetKey: 'USUARIO_ID'
});

const ato = await T_ATO.findOne({
  where: { ATO_ID: 1000 },
  include: [
    {
      association: 'usuario',
      as: 'usuario',
      attributes: ['USUARIO_ID', 'LOGIN', 'NOME_COMPLETO'],
      required: false
    }
  ]
});

console.log(ato?.dataValues.usuario?.LOGIN);
// Resposta esperada: `ato` vem com `usuario` carregado no include (ou `null` se nao achar).
```

```sql
SELECT
  a.ATO_ID, a.USUARIO_ID, u.USUARIO_ID, u.LOGIN, u.NOME_COMPLETO
FROM T_ATO a
LEFT JOIN G_USUARIO u ON u.USUARIO_ID = a.USUARIO_ID
WHERE a.ATO_ID = 1000
ROWS 1;
```

### Includes aninhados (com caso de uso)

Includes aninhados servem para carregar varios niveis de relacionamento em uma unica chamada, reduzindo idas e voltas ao banco.

Use include aninhado quando precisa carregar toda a hierarquia em uma consulta (ex.: ato -> usuario -> perfil):

```ts
const atoDetalhado = await T_ATO.findOne({
  where: { ATO_ID: 1000 },
  include: [
    {
      association: 'usuario',
      as: 'usuario',
      include: [
        {
          association: 'perfil',
          as: 'perfil'
        }
      ]
    }
  ]
});
// Resposta esperada: objeto com relacionamento aninhado `usuario.perfil`.
```

```sql
SELECT ...
FROM T_ATO a
LEFT JOIN G_USUARIO u ON u.USUARIO_ID = a.USUARIO_ID
LEFT JOIN G_PERFIL p ON p.PERFIL_ID = u.PERFIL_ID
WHERE a.ATO_ID = 1000
ROWS 1;
```

### Includes com `separate: true` (alto volume)

Quando uma relacao traz muitos itens, `separate: true` divide a carga em consultas mais controladas para evitar explosao de linhas no resultado.

Para reduzir explosão cartesiana em relações `hasMany`/`belongsToMany`, use `separate: true`:

```ts
const usuarios = await Usuario.findAll({
  where: { ATIVO: 'S' },
  include: [
    {
      association: 'atos',
      as: 'atos',
      separate: true,
      order: [['ATO_ID', 'DESC']],
      limit: 20
    }
  ]
});
// Resposta esperada: usuarios com `atos` carregados por consulta separada (`separate: true`).
```

```sql
-- Consulta 1
SELECT * FROM G_USUARIO WHERE ATIVO = 'S';
-- Consulta 2 (para carregar filhos sem explosao cartesiana)
SELECT * FROM T_ATO WHERE USUARIO_ID IN (...ids...) ORDER BY ATO_ID DESC ROWS 20;
```

### Mixins automáticos de associação

Mixins sao funcoes geradas automaticamente pelo ORM para navegar relacoes com menos codigo repetitivo.

- `belongsTo`: `getUsuario()`, `setUsuario()`
- `hasOne`: `getX()`, `setX()`
- `hasMany`: `getItens()`, `countItens()`, `addItem()`

## Scopes

Scopes sao filtros reutilizaveis. Eles ajudam a padronizar regras de consulta e evitar repetir o mesmo `where` em varios pontos do sistema.

```ts
T_ATO.addScope('ativos', {
  where: { ATIVO: 'A' }
});

const totalAtivos = await T_ATO.scope('ativos').count();
const atosAtivos = await T_ATO.scope('ativos').findAll({ limit: 10 });
// Resposta esperada: `totalAtivos` = numero; `atosAtivos` = lista filtrada pelo scope.
```

```sql
SELECT COUNT(*) FROM T_ATO WHERE ATIVO = 'A';
SELECT * FROM T_ATO WHERE ATIVO = 'A' ROWS 10;
```

`defaultScope` também pode ser definido via `Model.init`.

### `unscoped()` (ignorar filtro padrão)

`unscoped()` remove temporariamente o filtro padrao do model. E util para telas administrativas, auditoria ou manutencao.

Caso de uso: consultas administrativas que não devem herdar o `defaultScope`.

```ts
Usuario.init(
  {
    LOGIN: { type: DataTypes.STRING(60), allowNull: false },
    ATIVO: { type: DataTypes.STRING(1), allowNull: false, defaultValue: 'S' }
  },
  {
    tableName: 'G_USUARIO',
    defaultScope: { where: { ATIVO: 'S' } }
  }
);

const ativos = await Usuario.findAll(); // aplica defaultScope
const todos = await Usuario.unscoped().findAll(); // ignora defaultScope
// Resposta esperada: `ativos` vem filtrado; `todos` ignora o filtro padrao.
```

```sql
-- Com filtro padrao
SELECT * FROM G_USUARIO WHERE ATIVO = 'S';
-- Sem filtro padrao
SELECT * FROM G_USUARIO;
```

## Validação

Validacao permite barrar dados invalidos antes de salvar no banco. Isso melhora a qualidade da informacao e reduz erros em producao.

```ts
Usuario.init({
  LOGIN: {
    type: DataTypes.STRING(60),
    allowNull: false,
    validate: {
      minLen: (value) => (String(value || '').length >= 3) || 'LOGIN deve ter ao menos 3 caracteres'
    }
  }
}, { tableName: 'G_USUARIO' });
// Resposta esperada: validacoes passam a ser executadas em `create/save/update`.
```

Validações disparam em `save/create/update` e lançam `ValidationError`.

## Hooks

Hooks sao pontos de extensao executados antes/depois de eventos importantes (create, update, destroy), ideais para regras automaticas e auditoria.

Pense nos hooks como "gatilhos automaticos": quando algo acontece com o registro, o ORM chama sua funcao para voce validar, completar dados ou registrar log sem repetir codigo em varios lugares.

### `beforeCreate`

Roda antes de inserir um registro novo no banco.
Caso de uso: preencher valor padrao quando o usuario nao informou.

```ts
T_ATO.beforeCreate((instance) => {
  instance.set('ATIVO', instance.get('ATIVO') ?? 'A');
});
// Resposta esperada: todo novo registro sem `ATIVO` recebe valor padrao antes de inserir.
```

### `afterCreate`

Roda depois que o registro foi criado com sucesso.
Caso de uso: registrar auditoria de criacao.

```ts
T_ATO.afterCreate((instance) => {
  console.log('Ato criado com ID:', instance.get('ATO_ID'));
});
// Resposta esperada: log apos criacao bem-sucedida.
```

### `beforeUpdate`

Roda antes de atualizar um registro existente.
Caso de uso: validar regra de negocio antes da alteracao (ex.: impedir status invalido).

```ts
T_ATO.beforeUpdate((instance) => {
  const status = instance.get('SITUACAO_ATO');
  if (status === 'CANCELADO' && !instance.get('CANCELADO_MOTIVO')) {
    throw new Error('Informe o motivo antes de cancelar o ato.');
  }
});
// Resposta esperada: impede update invalido ao lancar erro de regra de negocio.
```

### `afterUpdate`

Roda depois da atualizacao no banco.
Caso de uso: registrar historico da mudanca ou disparar notificacao.

```ts
T_ATO.afterUpdate((instance) => {
  console.log('Ato atualizado:', instance.get('ATO_ID'));
});
// Resposta esperada: executa acao de pos-atualizacao (ex.: log/auditoria).
```

### `beforeSave`

Roda antes de salvar, tanto em criacao quanto em atualizacao.
Caso de uso: padronizar campos (trim, uppercase, flags) em um unico ponto.

```ts
T_ATO.beforeSave((instance) => {
  const obs = instance.get('OBSERVACAO');
  if (typeof obs === 'string') {
    instance.set('OBSERVACAO', obs.trim());
  }
});
// Resposta esperada: padroniza dados antes de salvar (create ou update).
```

### `afterSave`

Roda depois de salvar, tanto em criacao quanto em atualizacao.
Caso de uso: log unico de persistencia sem separar create/update.

```ts
T_ATO.afterSave((instance) => {
  console.log('Registro persistido:', instance.get('ATO_ID'));
});
// Resposta esperada: confirma persistencia apos `save/create/update`.
```

### `beforeDestroy`

Roda antes de excluir um registro.
Caso de uso: bloquear exclusao de dados sensiveis ou com vinculos obrigatorios.

```ts
T_ATO.beforeDestroy((instance) => {
  if (instance.get('SITUACAO_ATO') === 'FINALIZADO') {
    throw new Error('Nao e permitido excluir atos finalizados.');
  }
});
// Resposta esperada: bloqueia exclusao quando regra de negocio for violada.
```

### `afterDestroy`

Roda depois da exclusao no banco.
Caso de uso: registrar auditoria de exclusao ou limpar cache.

```ts
T_ATO.afterDestroy((instance) => {
  console.log('Ato removido:', instance.get('ATO_ID'));
});
// Resposta esperada: executa rotina de pos-exclusao (ex.: auditoria).
```

### Hook global (todos os models)

Se voce quiser uma regra geral para toda a aplicacao, pode registrar no ORM em vez de registrar model por model.

```ts
orm.addHook('beforeSave', (instance) => {
  // Exemplo: auditoria padrao para qualquer model
  console.log('Salvando registro de', instance.constructor.name);
});
// Resposta esperada: hook global roda para todos os models antes de salvar.
```

## Transações

Transacoes garantem consistencia: ou todas as etapas da operacao sao confirmadas, ou tudo e desfeito em caso de erro.

```ts
await orm.transaction(async (tx) => {
  const ato = await T_ATO.create(
    { PROTOCOLO: 123456, ATIVO: 'A' },
    { transaction: tx }
  );

  ato.set('OBSERVACAO', 'Dentro da transação');
  await ato.save({ transaction: tx });
});
// Resposta esperada: commit automatico se tudo der certo; rollback se houver erro.
```

```sql
SET TRANSACTION;
-- statements...
COMMIT; -- ou ROLLBACK em caso de falha
```

Se o callback lançar erro, o ORM executa rollback automaticamente.

Também é possível usar savepoint em uma transação já aberta:

```ts
await orm.transaction(async (tx) => {
  await orm.withSavepoint(tx, async () => {
    await T_ATO.update(
      { ATIVO: 'I' },
      { where: { ATO_ID: 1000 }, transaction: tx }
    );
  });
});
// Resposta esperada: usa savepoint interno; em falha, reverte apenas o bloco do savepoint.
```

```sql
SAVEPOINT SP1;
-- statements do bloco interno
-- em erro:
ROLLBACK TO SAVEPOINT SP1;
```

### Transações aninhadas (estilo Sequelize)

Transacoes aninhadas usam savepoints para isolar blocos internos sem perder o contexto da transacao principal.

Também é suportado `transaction({ transaction: txPai }, fn)`, que internamente usa savepoint:

```ts
await orm.transaction(async (txPai) => {
  await T_ATO.create({ PROTOCOLO: 777, ATIVO: 'A' }, { transaction: txPai });

  await orm.transaction({ transaction: txPai, savepointName: 'SP_AUDITORIA' }, async (txNested) => {
    await Auditoria.create(
      { ACAO: 'CRIACAO_ATO', CRIADO_EM: new Date() },
      { transaction: txNested }
    );
  });
});
// Resposta esperada: transacao aninhada compartilha contexto com isolamento por savepoint.
```

```sql
SET TRANSACTION;
SAVEPOINT SP_AUDITORIA;
-- statements internos
RELEASE SAVEPOINT SP_AUDITORIA; -- ou ROLLBACK TO SAVEPOINT
COMMIT;
```

## QueryInterface e metadata (schema)

O `QueryInterface` e a camada de administracao e introspeccao do banco. Com ele, voce inspeciona estrutura e executa operacoes de schema de forma programatica.

O ORM expõe uma camada de metadata/DDL incremental em `src/orm/schema/query-interface.ts`.

```ts
import { QueryInterface } from './src/orm';

const qi = new QueryInterface(orm.getConnection());

const tables = await qi.listTables();
const schemas = await qi.listSchemas(); // Firebird: retorna schema lógico ["PUBLIC"]
const cols = await qi.describeTable('T_ATO');
const fks = await qi.listForeignKeys();
const constraints = await qi.showConstraints('T_ATO');
const indexes = await qi.showIndexes('T_ATO');
// Resposta esperada: arrays com metadata de tabelas, schemas, colunas, FKs, constraints e indices.
```

```sql
-- Equivalentes consultando catalogo do Firebird (RDB$*)
SELECT TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0;
-- e consultas em RDB$RELATION_FIELDS / RDB$RELATION_CONSTRAINTS / RDB$INDICES
```

### `listTables()`

Lista as tabelas de usuario existentes no banco (nao retorna tabelas internas do sistema).
Caso de uso: montar tela de diagnostico mostrando quais tabelas estao disponiveis.

```ts
const tables = await qi.listTables();
console.log('Tabelas encontradas:', tables);
// Resposta esperada: lista de tabelas de usuario.
```

### `listSchemas()`

Retorna os schemas disponiveis. No Firebird, por compatibilidade, o retorno e um schema logico (`PUBLIC`).
Caso de uso: manter o mesmo fluxo da aplicacao que ja usa schema em outros bancos.

```ts
const schemas = await qi.listSchemas();
console.log('Schemas:', schemas); // ["PUBLIC"]
// Resposta esperada: lista de schemas disponiveis (no Firebird, schema logico).
```

### `tableExists(name)`

Verifica se uma tabela existe antes de criar, renomear ou excluir.
Caso de uso: evitar erro em deploy quando o ambiente ja esta parcialmente configurado.

```ts
if (!(await qi.tableExists('T_AUDITORIA'))) {
  console.log('Tabela ainda nao existe, pode criar.');
}
// Resposta esperada: booleano informando se a tabela existe.
```

### `describeTable(table)`

Mostra os detalhes das colunas da tabela (nome, tipo, nullable, default, posicao etc.).
Caso de uso: auditoria tecnica ou validacao automatica de estrutura esperada.

```ts
const columns = await qi.describeTable('T_ATO');
console.log(columns);
// Resposta esperada: lista de colunas com tipo, nullability, default e posicao.
```

### `listForeignKeys()`

Lista todas as chaves estrangeiras do banco.
Caso de uso: conferir relacionamentos reais antes de aplicar alteracoes de schema.

```ts
const foreignKeys = await qi.listForeignKeys();
console.log('Total de FKs:', foreignKeys.length);
// Resposta esperada: lista de chaves estrangeiras existentes no banco.
```

### `showConstraints(table?)`

Lista constraints (PK, UNIQUE, FK, CHECK). Pode filtrar por tabela.
Caso de uso: investigar por que uma insercao/atualizacao esta falhando por regra de restricao.

```ts
const constraints = await qi.showConstraints('T_ATO');
console.log(constraints);
// Resposta esperada: lista de constraints (PK, FK, UNIQUE, CHECK) da tabela.
```

### `showIndexes(table?)`

Lista indices do banco (ou de uma tabela especifica), incluindo colunas e se e unico.
Caso de uso: revisar performance e confirmar se indice esperado existe.

```ts
const indexes = await qi.showIndexes('T_ATO');
console.log(indexes);
// Resposta esperada: lista de indices, colunas e flag de unicidade.
```

### `createTable(...)`

Cria uma tabela com base nos atributos informados.
Caso de uso: bootstrap de ambiente novo, sem precisar rodar SQL manual.

```ts
await qi.createTable(
  'T_EXEMPLO',
  ['ID', 'NOME'],
  {
    ID: { type: DataTypes.BIGINT(), primaryKey: true, autoIncrement: true },
    NOME: { type: DataTypes.STRING(120), allowNull: false }
  }
);
// Resposta esperada: tabela criada quando nao existe (sem retorno de dados).
```

### `dropTable(table)`

Remove uma tabela existente.
Caso de uso: limpeza controlada em ambiente de teste/homologacao.

```ts
await qi.dropTable('T_EXEMPLO');
// Resposta esperada: tabela removida (se existir).
```

### `addForeignKey(spec)`

Adiciona uma chave estrangeira entre tabela filha e tabela pai.
Caso de uso: completar vinculo referencial apos criar tabelas.

```ts
await qi.addForeignKey({
  constraintName: 'FK_ATO_USUARIO',
  childTable: 'T_ATO',
  childField: 'USUARIO_ID',
  parentTable: 'G_USUARIO',
  parentField: 'USUARIO_ID',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});
// Resposta esperada: FK criada conectando tabela filha -> tabela pai.
```

### `truncateTable(table, { restartIdentity?, logging?, cascade?, ignoreIdentityRestartErrors? })`

Esvazia os dados da tabela. No Firebird, a operacao e feita via `DELETE FROM`.
Caso de uso: resetar dados temporarios de lote, log ou staging.

```ts
await qi.truncateTable('T_ATO_LOG', {
  restartIdentity: true,
  logging: true,
  ignoreIdentityRestartErrors: true
});
// Resposta esperada: dados da tabela limpos; identity reiniciada quando suportado.
```

### `renameTable(from, to, { ifExists?, logging? })`

Renomeia uma tabela para outro nome.
Caso de uso: migracao incremental, por exemplo `T_ATO_TMP` para `T_ATO_BKP`.

```ts
await qi.renameTable('T_ATO_TMP', 'T_ATO_BKP', {
  ifExists: true,
  logging: true
});
// Resposta esperada: tabela renomeada quando a origem existe.
```

```sql
ALTER TABLE T_ATO_TMP RENAME TO T_ATO_BKP;
```

### `removeIndex(table, indexName, { ifExists?, logging? })`

Remove um indice da tabela.
Caso de uso: substituir indice antigo por um novo desenho de performance.

```ts
await qi.removeIndex('T_ATO', 'IDX_T_ATO_PROTOCOLO', {
  ifExists: true,
  logging: true
});
// Resposta esperada: indice removido quando encontrado.
```

```sql
DROP INDEX IDX_T_ATO_PROTOCOLO;
```

## Logging, benchmark e encerramento

Estes recursos ajudam a observar desempenho, depurar consultas e fechar conexoes corretamente ao encerrar a aplicacao.

- `logging: true` imprime SQL.
- `logging: (sql, ms) => { ... }` usa logger custom.
- `benchmark: true` envia duração da query.
- `orm.close()` fecha o pool no shutdown da aplicação.

## Erros tipados

Erros tipados facilitam o tratamento correto de falhas no codigo, permitindo respostas mais claras para cada tipo de problema.

Exportados em `src/orm/index.ts`:
- `ValidationError`
- `DatabaseError`
- `UniqueConstraintError`
- `ForeignKeyConstraintError`
- `ConnectionError`
- `ConnectionRefusedError`
- `ConnectionTimedOutError`
- `ConnectionAcquireTimeoutError`

Erros de conexão são mapeados pelo `mapDatabaseError` com base em `code`/mensagem (por exemplo `ECONNREFUSED`, `ETIMEDOUT`, timeout de aquisição no pool).

## Segurança de SQL

O ORM aplica protecoes para reduzir risco de injecao de SQL em nomes dinamicos de tabela, coluna e ordenacao.

O query builder aplica saneamento de identifiers para tabelas, colunas, aliases e `order by`, reduzindo risco de SQL injection via nomes dinâmicos.

## Limitações atuais (compatibilidade prática)

Esta parte deixa transparente o que ainda nao e equivalente a todos os recursos de outros dialetos/ORMs, ajudando no planejamento tecnico.

- `truncateTable` em Firebird usa `DELETE FROM` (sem semântica completa de `TRUNCATE ... CASCADE` de outros dialetos).
- `listSchemas` retorna um schema lógico (`PUBLIC`), já que Firebird não modela schemas como Postgres.
- `sync` cobre criação de tabelas/FKs e introspecção, mas não substitui um sistema completo de migrações evolutivas.
- Mapeamento de erros é granular para os casos mais comuns, mas pode ser expandido para cobrir mais códigos específicos do Firebird.

## Scripts utilitários

Esses comandos ajudam em tarefas operacionais e de manutencao, como descoberta de metadata e validacao de associacoes.

- `npm run discover`: lista generators/sequences.
- `npm run hunt`: inspeção de trigger para contador.
- `npm run metadata`: exportação de metadados.
- `npm run validate:associations`: valida vínculos gerados.