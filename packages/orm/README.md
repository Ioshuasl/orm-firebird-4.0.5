# ocr-firebird

ORM para Firebird com API inspirada no Sequelize (classes de model, `Op`, `include`, hooks, scopes e transações).

## Instalação
Use esta seção para instalar a biblioteca e preparar as dependências mínimas no projeto.

```bash
npm i ocr-firebird node-firebird
```

> `node-firebird` é o driver de conexão com o Firebird.

## Pré-requisitos
Antes de rodar os exemplos, garanta que seu ambiente local e seu servidor Firebird atendem aos requisitos básicos abaixo.

- Node.js 18+ (recomendado Node.js 20+)
- Acesso a um banco Firebird (local ou remoto)
- Credenciais válidas para conexão (`host`, `port`, `database`, `user`, `password`)
- Permissão de rede para acessar a porta do Firebird (normalmente `3050`)
- Dependência `node-firebird` instalada (o `ocr-firebird` já declara essa dependência)

## Compatibilidade
O pacote funciona em projetos JavaScript e TypeScript no Node.js, com runtime em JavaScript e tipagem oficial para TypeScript.

### Uso em JavaScript (CommonJS)
Use `require` quando seu projeto estiver em JavaScript tradicional (CommonJS).

```js
const { OriusORM } = require('ocr-firebird');

const orm = new OriusORM({
  host: '127.0.0.1',
  port: 3050,
  database: 'SAOFRANCISCO',
  user: 'SYSDBA',
  password: 'masterkey'
});
```

### Uso em TypeScript (ESM/CJS)
Use `import` para aproveitar as tipagens incluídas no pacote (`.d.ts`).

```ts
import { OriusORM } from 'ocr-firebird';
```

## Quickstart
Este fluxo mostra o caminho mais curto para criar a instância do ORM e validar conexão.

### 1) `new OriusORM(...)`
Nesta etapa você configura a conexão com o Firebird e opções de execução do ORM.

```ts
import { OriusORM } from 'ocr-firebird';

const orm = new OriusORM({
  host: '127.0.0.1',
  port: 3050,
  database: 'SAOFRANCISCO',
  user: 'SYSDBA',
  password: 'masterkey',
  encoding: 'UTF8',
  maxPool: 10,
  logging: true,
  benchmark: true
});
```

### 2) `orm.authenticate()`
Aqui você valida se as credenciais e o endpoint do banco estão corretos antes de usar models.

```ts
await orm.authenticate();
// Resposta esperada: conexão validada com sucesso.
```

### 3) `Model.sync(...)` e `syncOriusORM(...)`
Use esta etapa para sincronizar estruturas de tabela/relacionamento com base nos models já registrados no ORM.

```ts
import { syncOriusORM } from 'ocr-firebird';

// Sincroniza todos os models registrados no orm (cria tabelas faltantes e depois FKs faltantes)
const fullSync = await syncOriusORM(orm, {
  logging: true
});

// Sincroniza somente um model específico
await G_USUARIO.sync({ orm, logging: true });

// Modo seguro de prévia (não executa SQL, apenas gera no resultado)
const preview = await syncOriusORM(orm, {
  dryRun: true
});
console.log(preview.sql);
```

Opções mais úteis de sincronização:

- `dryRun`: gera SQL sem executar no banco.
- `force`: remove tabelas existentes (ordem reversa de dependência) e recria. Use com cautela.
- `fksOnly`: aplica somente FKs faltantes.
- `tablesOnly`: cria somente tabelas/colunas (sem FKs).
- `modelNames`: sincroniza apenas subset de models por nome de classe ou tabela.

Retorno de sincronização (`SyncResult`):

- `createdTables`: tabelas criadas.
- `createdForeignKeys`: constraints FK criadas.
- `droppedTables`: tabelas removidas quando `force` estiver ativo.
- `skipped`: itens já existentes que foram ignorados.
- `sql`: SQL gerado/executado em ordem.

## Definição de modelos
Esta seção apresenta as formas principais de mapear tabelas Firebird para classes e modelos ORM.

### `Model.init(...)`
Use este formato quando quiser declarar a estrutura do model de forma explícita e orientada a classe.

```ts
import { Model, DataTypes } from 'ocr-firebird';

class G_USUARIO extends Model {}

G_USUARIO.init(
  {
    USUARIO_ID: { type: DataTypes.BIGINT(), primaryKey: true, autoIncrement: true },
    LOGIN: { type: DataTypes.STRING(60), allowNull: false },
    NOME_COMPLETO: { type: DataTypes.STRING(150), allowNull: false },
    EMAIL: { type: DataTypes.STRING(150) }
  },
  {
    tableName: 'G_USUARIO',
    primaryKey: 'USUARIO_ID',
    orm
  }
);
```

### `orm.define(...)`
Use este formato para registrar modelos dinamicamente com menos boilerplate.

```ts
import { DataType } from 'ocr-firebird';

const T_ATO = orm.define(
  'T_ATO',
  {
    ATO_ID: { type: DataType.BIGINT, primaryKey: true, autoIncrement: true },
    PROTOCOLO: { type: DataType.BIGINT },
    USUARIO_ID: { type: DataType.BIGINT }
  },
  {
    tableName: 'T_ATO',
    primaryKey: 'ATO_ID'
  }
);
```

## DataTypes e validação (`validate`)
Aqui você define tipos de coluna e regras de validação para impedir dados inválidos em runtime.

```ts
const Usuario = orm.define(
  'Usuario',
  {
    ID: { type: DataTypes.BIGINT(), primaryKey: true, autoIncrement: true },
    LOGIN: {
      type: DataTypes.STRING(60),
      allowNull: false,
      validate: {
        len: [3, 60]
      }
    },
    EMAIL: {
      type: DataTypes.STRING(150),
      validate: {
        isEmail: true
      }
    },
    STATUS: {
      type: DataTypes.ENUM('A', 'I'),
      defaultValue: 'A'
    }
  },
  { tableName: 'G_USUARIO', primaryKey: 'ID' }
);
// Resposta esperada: dados inválidos em create/save/update disparam ValidationError.
```

## CRUD principal
Este bloco cobre as operações básicas de criação, leitura, atualização e remoção de registros.

```ts
// CREATE
const novo = await T_ATO.create({
  PROTOCOLO: 12345,
  USUARIO_ID: 1
});

// FIND ALL
const rows = await T_ATO.findAll({
  order: [['ATO_ID', 'DESC']],
  limit: 10
});

// FIND + COUNT (paginação)
const page = await T_ATO.findAndCountAll({
  limit: 10,
  offset: 0,
  order: [['ATO_ID', 'DESC']]
});

// COUNT
const total = await T_ATO.count({
  where: { USUARIO_ID: 1 }
});

// UPDATE (estático)
const [affected] = await T_ATO.update(
  { PROTOCOLO: 99999 },
  { where: { ATO_ID: novo.dataValues.ATO_ID } }
);

// DESTROY (estático)
const deleted = await T_ATO.destroy({
  where: { ATO_ID: novo.dataValues.ATO_ID }
});
```

## Transações
Use transações para garantir consistência quando múltiplas operações precisam ter sucesso juntas.

```ts
await orm.transaction(async (tx) => {
  const ato = await T_ATO.create(
    { PROTOCOLO: 777, USUARIO_ID: 1 },
    { transaction: tx }
  );

  await T_ATO.update(
    { PROTOCOLO: 778 },
    { where: { ATO_ID: ato.dataValues.ATO_ID }, transaction: tx }
  );
});
// Resposta esperada: commit automático se tudo der certo, rollback se houver erro.
```

### Transação aninhada (savepoint)
Este padrão permite isolar partes da transação com rollback parcial via savepoints.

```ts
await orm.transaction(async (txPai) => {
  await orm.transaction({ transaction: txPai, savepointName: 'SP1' }, async (txNested) => {
    await T_ATO.create({ PROTOCOLO: 888, USUARIO_ID: 1 }, { transaction: txNested });
  });
});
```

## Associações
Esta seção mostra como relacionar modelos para consultar dados conectados entre tabelas.

```ts
G_USUARIO.hasMany(T_ATO, {
  as: 'atos',
  foreignKey: 'USUARIO_ID',
  sourceKey: 'USUARIO_ID'
});

T_ATO.belongsTo(G_USUARIO, {
  as: 'usuario',
  foreignKey: 'USUARIO_ID',
  targetKey: 'USUARIO_ID'
});
```

## Consultas com `where`, `include`, includes aninhados e operadores
Aqui você encontra exemplos de filtros avançados, joins por associação e operadores no estilo Sequelize.

```ts
import { Op } from 'ocr-firebird';

const atos = await T_ATO.findAll({
  where: {
    [Op.or]: [{ SITUACAO_ATO: '1' }, { SITUACAO_ATO: '2' }],
    ATO_ID: { [Op.gt]: 1000 },
    PROTOCOLO: { [Op.notIn]: [10, 20, 30] }
  },
  include: [
    {
      association: 'usuario',
      as: 'usuario',
      attributes: ['USUARIO_ID', 'LOGIN', 'NOME_COMPLETO']
    }
  ],
  order: [['ATO_ID', 'DESC']],
  limit: 20
});
```

### Include aninhado
Use include aninhado para carregar relacionamentos em múltiplos níveis na mesma consulta.

```ts
const result = await T_ATO.findAll({
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
  ],
  limit: 10
});
```

### Include com `separate: true`
Este modo executa consultas separadas por associação para cenários específicos de desempenho e paginação.

```ts
const users = await G_USUARIO.findAll({
  include: [
    {
      association: 'atos',
      as: 'atos',
      separate: true,
      limit: 10,
      order: [['ATO_ID', 'DESC']]
    }
  ]
});
```

## Hooks
Hooks permitem executar lógica antes e depois de eventos de persistência como create, update e destroy.

```ts
T_ATO.beforeCreate((instance) => {
  instance.set('SITUACAO_ATO', instance.get('SITUACAO_ATO') ?? '1');
});

T_ATO.afterCreate((instance) => {
  console.log('Ato criado:', instance.get('ATO_ID'));
});

T_ATO.beforeUpdate((instance) => {
  console.log('Antes de atualizar:', instance.get('ATO_ID'));
});

T_ATO.afterUpdate((instance) => {
  console.log('Depois de atualizar:', instance.get('ATO_ID'));
});

T_ATO.beforeDestroy((instance) => {
  console.log('Antes de remover:', instance.get('ATO_ID'));
});

T_ATO.afterDestroy((instance) => {
  console.log('Depois de remover:', instance.get('ATO_ID'));
});
```

## Encerramento da conexão
Finalize o pool de conexões ao encerrar a aplicação para liberar recursos corretamente.

```ts
orm.close();
```

## Build local da lib
Este comando gera a pasta `dist` usada para distribuição do pacote npm.

No repositório raiz:

```bash
npm run build:orm
```

## Publicação no npm
Siga estes passos para publicar uma nova versão da biblioteca no registro do npm.

```bash
cd packages/orm
npm publish --access public
```
