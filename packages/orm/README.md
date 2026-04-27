# @orius/firebird-orm

ORM para Firebird com API inspirada no Sequelize (classes de model, `Op`, `include`, hooks, scopes e transações).

## Instalação

```bash
npm i @orius/firebird-orm node-firebird
```

> `node-firebird` é o driver de conexão com o Firebird.

## Quickstart

### 1) `new OriusORM(...)`

```ts
import { OriusORM } from '@orius/firebird-orm';

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

```ts
await orm.authenticate();
// Resposta esperada: conexão validada com sucesso.
```

## Definição de modelos

### `Model.init(...)`

```ts
import { Model, DataTypes } from '@orius/firebird-orm';

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

```ts
import { DataType } from '@orius/firebird-orm';

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

```ts
await orm.transaction(async (txPai) => {
  await orm.transaction({ transaction: txPai, savepointName: 'SP1' }, async (txNested) => {
    await T_ATO.create({ PROTOCOLO: 888, USUARIO_ID: 1 }, { transaction: txNested });
  });
});
```

## Associações

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

```ts
import { Op } from '@orius/firebird-orm';

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

```ts
orm.close();
```

## Build local da lib

No repositório raiz:

```bash
npm run build:orm
```

## Publicação no npm

```bash
cd packages/orm
npm publish --access public
```
