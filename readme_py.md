# ORM Firebird Python (Sequelize-like)

ORM em Python para Firebird com API inspirada no Sequelize: conexao flexivel por charset, modelos orientados a classe, operadores com `Op`, `include`, transacoes, hooks e schema introspection.

## Principais recursos implementados

Esta secao resume o que o ORM Python ja entrega para reduzir SQL manual no dia a dia.

- Inicializacao com `OriusORM(config)` e suporte a `UTF8` e `ANSI/ISO8859_1`.
- API de model estilo Sequelize (`create/findAll/findOne/findByPk/count/findAndCountAll/update/destroy/save`).
- Metodos de instancia (`isNewRecord`, `changed`, `previous`, `get`, `set`).
- Operadores com `Op` (`and_/or_/in_/notIn/between/notBetween/is_/not_` e alias `$...`).
- Associacoes (`belongsTo`, `hasOne`, `hasMany`, `belongsToMany`) com `include`, aninhado e `separate`.
- Hooks de ciclo de vida (`beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, etc.).
- Transacoes com rollback automatico e suporte a transacoes aninhadas (savepoint).
- Schema tools com `QueryInterface` (`list_tables`, `table_exists`, `list_foreign_keys`, `describe_table` e mais).
- Utilitarios para JSON e BLOB (`to_json_response`, `blob_utils`).

## Conexao com banco e autenticacao

Aqui voce configura a conexao com Firebird e valida conectividade com `authenticate()`.
No Python ORM, o charset e flexivel por `.env`, permitindo `UTF8` ou `ANSI_CHARSET`/`ISO8859_1`.

```python
import os
from pathlib import Path
from orm_py import OriusORM, normalize_firebird_charset, is_ansi_charset

def load_dotenv(path=".env"):
    data = {}
    p = Path(path)
    if not p.exists():
        return data
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip()
    return data

env = load_dotenv(".env")
runtime_charset = normalize_firebird_charset(env.get("ORIUS_API_FDB_CHARSET"), default="UTF8")
driver_charset = "ISO8859_1" if is_ansi_charset(runtime_charset) else "UTF8"

config = {
    "host": env["ORIUS_API_FDB_HOST"],
    "port": int(env.get("ORIUS_API_FDB_PORT", "3050")),
    "database": env["ORIUS_API_FDB_NAME"],
    "user": env["ORIUS_API_FDB_USER"],
    "password": env["ORIUS_API_FDB_PASSWORD"],
    "charset": driver_charset,
    "pool_pre_ping": True,
    "pool_size": int(env.get("ORIUS_API_FDB_POOL_SIZE", "5")),
    "max_overflow": int(env.get("ORIUS_API_FDB_POOL_MAX_OVERFLOW", "10")),
    "connect_args": {"charset": driver_charset},
    "logging": True,
}

fbclient = env.get("FDB_CLIENT_LIBRARY", r"C:\Program Files\Firebird\Firebird_4_0\fbclient.dll")
if Path(fbclient).exists():
    os.environ["FIREBIRD_CLIENT_LIBRARY"] = fbclient

orm = OriusORM(config)
orm.authenticate()
rows = orm.get_connection().execute("SELECT 1 AS OK FROM RDB$DATABASE")
print(rows)
# Resposta esperada: [{"ok": 1}]
```

```sql
-- SQL equivalente de autenticacao/conectividade
SELECT 1 AS OK FROM RDB$DATABASE;
```

Observacao:
- Se `.env` vier com charset vazio/nulo, use `UTF8` como padrao.
- Para banco legado ANSI, use `ISO8859_1` na conexao e utilitarios de charset/blob no retorno.

## Definicao de modelos com `.init` e `.define`

Modelos representam tabelas. O ORM Python suporta os dois estilos: `Model.init(...)` e `orm.define(...)`.

### Estilo `Model.init(...)`

```python
from orm_py import Model, DataTypes

class G_USUARIO(Model):
    pass

G_USUARIO.init(
    {
        "USUARIO_ID": {"type": DataTypes.NUMERIC(10, 2), "primaryKey": True, "autoIncrement": False},
        "LOGIN": {"type": DataTypes.STRING(60), "allowNull": False},
        "NOME_COMPLETO": {"type": DataTypes.STRING(150), "allowNull": True},
    },
    {
        "tableName": "G_USUARIO",
        "modelName": "G_USUARIO",
        "primaryKey": "USUARIO_ID",
        "orm": orm,
    },
)
# Resposta esperada: model registrado e pronto para CRUD.
```

### Estilo `orm.define(...)`

```python
from orm_py import DataTypes

T_ATO = orm.define(
    "T_ATO",
    {
        "ATO_ID": {"type": DataTypes.NUMERIC(10, 2), "primaryKey": True, "autoIncrement": False},
        "PROTOCOLO": {"type": DataTypes.NUMERIC(10, 2)},
        "USUARIO_ID": {"type": DataTypes.NUMERIC(10, 2)},
    },
    {
        "tableName": "T_ATO",
        "primaryKey": "ATO_ID",
    },
)
# Resposta esperada: classe dinamica "T_ATO" registrada em orm.models.
```

Comparacao:
- TypeScript: `Model.init(...)` e `orm.define(...)`.
- Python: mesma ideia, com payload em `dict`.

## DataTypes, references e validacao

Esta secao define tipos de coluna, relacoes (`references`) e regras de validacao.

### Todos os DataTypes disponiveis (`src/orm_py/data_types.py`)

O ORM Python suporta duas formas, igual ao padrao Sequelize-like:
- `DataType.X` (enum direto)
- `DataTypes.X(...)` (factory com parametros)

#### Lista completa de `DataType` (enum)

```python
from orm_py import DataType

# Todos os enums atualmente disponiveis:
DataType.STRING
DataType.CHAR
DataType.INTEGER
DataType.SMALLINT
DataType.BIGINT
DataType.NUMERIC
DataType.FLOAT
DataType.DOUBLE
DataType.TEXT
DataType.BINARY
DataType.BOOLEAN
DataType.DATE
DataType.TIME
DataType.DATEONLY
DataType.TIMESTAMP
DataType.DECIMAL
DataType.ENUM
DataType.BLOB
DataType.BLOB_BINARY
```

#### Lista completa de `DataTypes` (factory)

```python
from orm_py import DataTypes

# Texto
DataTypes.STRING(255)
DataTypes.CHAR(1)
DataTypes.TEXT()

# Inteiros e numericos
DataTypes.INTEGER()
DataTypes.SMALLINT()
DataTypes.BIGINT()
DataTypes.NUMERIC(18, 0)
DataTypes.DECIMAL(18, 2)
DataTypes.FLOAT()
DataTypes.DOUBLE()

# Data e hora
DataTypes.DATE()
DataTypes.TIME()
DataTypes.DATEONLY()
DataTypes.TIMESTAMP()

# Boolean
DataTypes.BOOLEAN()

# BLOBs
DataTypes.BLOB()
DataTypes.BLOB_TEXT()
DataTypes.BLOB_BINARY()

# Enum
DataTypes.ENUM("A", "I", "PENDENTE")
```

#### Exemplo unico usando todos os grupos

```python
from orm_py import DataType, DataTypes

schema_exemplo = {
    "ID": {"type": DataTypes.NUMERIC(10, 2), "primaryKey": True},
    "NOME": {"type": DataTypes.STRING(120), "allowNull": False},
    "TIPO_FIXO": {"type": DataTypes.CHAR(1)},
    "IDADE": {"type": DataTypes.INTEGER()},
    "STATUS_NUM": {"type": DataTypes.SMALLINT()},
    "CODIGO_LONGO": {"type": DataTypes.BIGINT()},
    "ATIVO": {"type": DataType.STRING, "defaultValue": "S"},
    "FLUTUANTE": {"type": DataTypes.FLOAT()},
    "PRECISAO_DUPLA": {"type": DataTypes.DOUBLE()},
    "VALOR": {"type": DataTypes.DECIMAL(18, 2)},
    "VALOR_NUMERIC": {"type": DataTypes.NUMERIC(10, 2)},
    "FLAG": {"type": DataTypes.BOOLEAN()},
    "DATA_REF": {"type": DataTypes.DATE()},
    "HORA_REF": {"type": DataTypes.TIME()},
    "SOMENTE_DATA": {"type": DataTypes.DATEONLY()},
    "CRIADO_EM": {"type": DataType.TIMESTAMP},
    "TEXTO_LONGO": {"type": DataTypes.TEXT()},
    "BLOB_GENERICO": {"type": DataTypes.BLOB()},
    "BLOB_TEXTO": {"type": DataTypes.BLOB_TEXT()},
    "ARQUIVO_BINARIO": {"type": DataTypes.BLOB_BINARY()},
    "PERFIL": {"type": DataTypes.ENUM("admin", "operador", "consulta")},
}
```

Resposta esperada:
- Todos os tipos acima sao aceitos no schema do model.
- A resolucao final para SQLAlchemy/Firebird e feita internamente pelo ORM.
- Para BLOB binario em Firebird, prefira `DataTypes.BLOB_BINARY()`/`DataType.BLOB_BINARY`.

### References (FK)

```python
T_ATO = orm.define(
    "T_ATO",
    {
        "ATO_ID": {"type": DataTypes.NUMERIC(10, 2), "primaryKey": True},
        "USUARIO_ID": {
            "type": DataTypes.NUMERIC(10, 2),
            "references": {"model": "G_USUARIO", "key": "USUARIO_ID"},
            "onUpdate": "CASCADE",
            "onDelete": "SET NULL",
        },
    },
    {"tableName": "T_ATO", "primaryKey": "ATO_ID"},
)
# Resposta esperada: metadata de FK no model; sync/schema pode materializar constraint.
```

### Validacao de atributos

Agora o ORM Python suporta a mesma ideia de validacao por atributo da versao TS:
- `validate` pode ser funcao unica, ou objeto com validadores built-in e custom.
- A validacao roda em `create()`, `save()` e `update()` (payload parcial no update).
- Violacoes geram `ValidationError` (encapsulada por `OriusORMError` nas operacoes).

Built-ins suportados:
- `notEmpty`, `isNull`
- `isIn`, `notIn`
- `min`, `max`, `len`
- `isEmail`, `isUrl`, `isIP`, `isUUID`, `isDate`
- `isInt`, `isFloat`, `isDecimal`, `isNumeric`
- `isAlpha`, `isAlphanumeric`
- `matches`, `contains`, `notContains`
- `isAfter`, `isBefore`, `equals`, `not`

```python
Usuario = orm.define(
    "G_USUARIO_DOC",
    {
        "USUARIO_ID": {"type": DataTypes.NUMERIC(10, 2), "primaryKey": True, "allowNull": False},
        "LOGIN": {
            "type": DataTypes.STRING(60),
            "allowNull": False,
            "validate": {
                "notEmpty": True,
                "len": [3, 60],
                "isAlphanumeric": True,
            },
        },
        "EMAIL": {
            "type": DataTypes.STRING(150),
            "validate": {"isEmail": True},
        },
        "IDADE": {
            "type": DataTypes.INTEGER(),
            "validate": {"min": 18, "max": 120, "isInt": True},
        },
        "PERFIL": {
            "type": DataTypes.ENUM("admin", "operador", "consulta"),
            "validate": {"isIn": [["admin", "operador", "consulta"]]},
        },
        "CPF": {
            "type": DataTypes.STRING(14),
            "validate": {
                "matches": [r"^\d{3}\.\d{3}\.\d{3}-\d{2}$"],
                "cpfCustom": lambda v: True if v and len(str(v)) == 14 else "CPF invalido",
            },
        },
    },
    {"tableName": "G_USUARIO_DOC", "primaryKey": "USUARIO_ID"},
)

# create: valida payload completo
Usuario.create({"USUARIO_ID": 1, "LOGIN": "USR01", "EMAIL": "usr@dominio.com", "IDADE": 20, "PERFIL": "admin"})

# update: valida apenas os campos enviados no values
Usuario.update({"EMAIL": "email-invalido"}, {"where": {"USUARIO_ID": 1}})
# Resposta esperada: erro de validacao com detalhes.
```

Comparacao (TS x PY):
- TS: `validate` em `ColumnOptions` + `runValidateEntry` em `validators.ts`.
- PY: mesma abordagem com `validate` em schema e `orm_py/validators.py`.

## Configuracoes essenciais de coluna

As opcoes abaixo seguem o mesmo padrao da versao TS:
- `primaryKey`
- `autoIncrement`
- `allowNull`
- `defaultValue`
- `sequence`

```python
Pedido = orm.define(
    "T_PEDIDO",
    {
        "ID": {
            "type": DataTypes.NUMERIC(10, 2),
            "primaryKey": True,
            "autoIncrement": True,
            "sequence": "GEN_T_PEDIDO",
        },
        "STATUS": {"type": DataTypes.STRING(20), "allowNull": False, "defaultValue": "ABERTO"},
        "CRIADO_EM": {"type": DataType.TIMESTAMP, "allowNull": False},
    },
    {"tableName": "T_PEDIDO", "primaryKey": "ID"},
)
# Resposta esperada: schema configurado com PK, default e sequence.
```

```sql
-- SQL equivalente (conceitual)
CREATE TABLE T_PEDIDO (
  ID NUMERIC(10,2) NOT NULL PRIMARY KEY,
  STATUS VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
  CRIADO_EM TIMESTAMP NOT NULL
);
```

## CRUD completo

A API abaixo retorna resposta orientada a JSON (via `to_json_response` interno).

```python
# create
created = G_USUARIO.create({"USUARIO_ID": 990100})
print(created)
# Esperado: {"USUARIO_ID": "990100", ...}

# set + save (instancia)
inst = G_USUARIO(USUARIO_ID=990100)
inst.set("LOGIN", "USR_TESTE")
saved = inst.save()
print(saved)
# Esperado: instancia persistida em JSON

# update
updated = G_USUARIO.update(
    {"LOGIN": "USR_TESTE_2"},
    {"where": {"USUARIO_ID": 990100}},
)
print(updated)
# Esperado: {"count": <qtd_afetada>, "rows": [...] } (conforme implementacao atual)

# destroy
deleted = G_USUARIO.destroy({"where": {"USUARIO_ID": 990100}})
print(deleted)
# Esperado: {"count": <qtd_removida>}

# count
total = G_USUARIO.count({"where": {"USUARIO_ID": {"$gt": 0}}})
print(total)
# Esperado: {"count": N}

# findAll
rows = G_USUARIO.findAll({"limit": 5, "order": [("USUARIO_ID", "DESC")]})
print(rows)
# Esperado: lista de objetos JSON

# findAndCountAll
paged = G_USUARIO.findAndCountAll({"limit": 5, "offset": 0})
print(paged)
# Esperado: {"count": N, "rows": [...]}

# findOne
one = G_USUARIO.findOne({"where": {"USUARIO_ID": 123472}})
print(one)
# Esperado: objeto JSON ou None

# findByPk
by_pk = G_USUARIO.findByPk(123472)
print(by_pk)
# Esperado: objeto JSON ou None
```

```sql
-- Comparacao SQL (resumo)
INSERT INTO G_USUARIO (...) VALUES (...);
UPDATE G_USUARIO SET ... WHERE ...;
DELETE FROM G_USUARIO WHERE ...;
SELECT COUNT(*) FROM G_USUARIO WHERE ...;
SELECT * FROM G_USUARIO WHERE ...;
```

## Metodos auxiliares de instancia

Metodos `isNewRecord`, `changed`, `previous`, `set`, `get` ajudam no estado da instancia.

```python
u = G_USUARIO(USUARIO_ID=991000)

print(u.isNewRecord())   # True
print(u.changed())       # []
print(u.previous())      # {"USUARIO_ID": 991000}
print(u.get("USUARIO_ID"))

u.set("USUARIO_ID", 991001)
print(u.changed("USUARIO_ID"))   # True ou nome em lista (conforme uso)
print(u.previous("USUARIO_ID"))  # 991000

u.set({"LOGIN": "NOVO_LOGIN"})
print(u.get("LOGIN"))            # NOVO_LOGIN
```

Comparacao:
- TypeScript: mesmo conceito de `isNewRecord/changed/previous/get/set`.
- Python: mesma API publica com aliases camelCase.

## Outros metodos auxiliares (`blob_utils` e `json_response`)

### `to_json_response` (`src/orm_py/utils/json_response.py`)

Converte `Decimal`, `datetime`, enums e objetos de model para payload serializavel.

```python
from orm_py import to_json_response
from decimal import Decimal

payload = {
    "id": Decimal("10.00"),
    "nome": "Teste",
}
print(to_json_response(payload))
# Esperado: {"id": "10.00", "nome": "Teste"} (ou numero/str conforme regra atual)
```

### `blob_utils` (`src/orm_py/utils/blob_utils.py`)

Utilitario para materializar e diagnosticar BLOBs (texto/binario), incluindo deteccao de formato.

Quando usar:
- voce tem colunas `BLOB SUB_TYPE BINARY` em tabelas como `T_ATO`.
- precisa descobrir se o binario e `rtf`, `docx`, `json`, `xml`, `txt`, `zip`, imagem etc.
- precisa padronizar retorno para debug (`bytes` ou `base64`) sem quebrar serializacao.

Funcoes principais:
- `materialize_blob_value(...)`: converte um valor blob isolado.
- `materialize_blobs_in_row(...)`: converte campos blob de uma linha.
- `materialize_blobs_in_rows(...)`: converte campos blob de uma lista de linhas.
- `detect_binary_format(...)`: detecta formato/mime/extensao por assinatura (magic bytes), incluindo `rtf-zlib`.

```python
from orm_py import materialize_blob_value, detect_binary_format

raw = b"{\\rtf1\\ansi Exemplo}"
materialized = materialize_blob_value(raw, charset="ISO8859_1")
fmt = detect_binary_format(raw, charset="ISO8859_1")

print(materialized)
print(fmt)
# Esperado: texto legivel + metadados de formato (ex.: rtf/txt/json/xml/zip/docx etc.).
```

#### Debug real em `T_ATO` (campos binarios)

Exemplo pratico no mesmo estilo dos testes de terminal:

```python
import json
from orm_py import detect_binary_format, materialize_blobs_in_rows

blob_fields = ["TEXTO_ASSINATURA", "TEXTO", "TEXTO_FINALIZACAO", "TEXTO_IMOVEL_GERAL"]

rows = T_ATO.findAll(
    {
        "attributes": ["ATO_ID", *blob_fields],
        "where": {
            "$or": [{field: {"$ne": None}} for field in blob_fields],
        },
        "order": [("ATO_ID", "DESC")],
        "limit": 3,
    }
)

# Materializa os campos BLOB como binario (bytes/base64) de forma consistente
materialized = materialize_blobs_in_rows(
    rows,
    blob_fields={field: "binary" for field in blob_fields},
    charset="ISO8859_1",
    binary_mode="bytes",  # use "base64" se quiser serializar direto em JSON
)

for row in materialized:
    print(f"\n--- ATO_ID={row.get('ATO_ID')} ---")
    for field in blob_fields:
        value = row.get(field)
        if value is None:
            print(f"{field}: null")
            continue

        if isinstance(value, (bytes, bytearray)):
            info = detect_binary_format(bytes(value), charset="ISO8859_1")
            print(f"{field}: bytes={len(value)} -> {json.dumps(info, ensure_ascii=False)}")
            continue

        if isinstance(value, str):
            info = detect_binary_format(value, charset="ISO8859_1")
            print(f"{field}: str={len(value)} -> {json.dumps(info, ensure_ascii=False)}")
            continue

        print(f"{field}: tipo={type(value).__name__}")
```

Resposta esperada no terminal:
- para blobs de texto RTF: `{"format":"rtf","mime":"application/rtf","extension":".rtf", ...}`
- para blobs comprimidos: `{"format":"rtf-zlib", ...}` ou `{"format":"zlib", "decoded": {...}}`
- para dados textuais puros: `txt/json/xml` com charset detectado
- para binario desconhecido: `{"format":"binary","extension":".bin", ...}`

Comparacao com SQL:

```sql
SELECT FIRST 3
  ATO_ID,
  TEXTO_ASSINATURA,
  TEXTO,
  TEXTO_FINALIZACAO,
  TEXTO_IMOVEL_GERAL
FROM T_ATO
WHERE TEXTO_ASSINATURA IS NOT NULL
   OR TEXTO IS NOT NULL
   OR TEXTO_FINALIZACAO IS NOT NULL
   OR TEXTO_IMOVEL_GERAL IS NOT NULL
ORDER BY ATO_ID DESC;
```

Observacao:
- Em bancos ANSI, prefira passar `charset="ISO8859_1"` nesses helpers para evitar mojibake.
- Se voce precisa enviar resposta via API JSON, prefira `binary_mode="base64"` para evitar erro de serializacao de `bytes`.

## Consultas e operadores

A API de `where` aceita tanto operadores estilo `$op` quanto tokens `Op`.

```python
from orm_py import Op

rows = T_ATO.findAll(
    {
        "where": {
            Op.or_: [
                {"SITUACAO_ATO": "1"},
                {"SITUACAO_ATO": "2"},
            ],
            "ATO_ID": {Op.between: [1000, 2000]},
            "PROTOCOLO": {"$notIn": [10, 20, 30]},
        },
        "order": [("ATO_ID", "DESC")],
        "limit": 50,
        "offset": 0,
    }
)
print(rows)
# Esperado: lista filtrada por OR + BETWEEN + NOT IN.
```

### Explicacao de todos os operadores (`src/orm_py/operators.py`)

Comparacao de sintaxe aceita:
- Token Python: `{Op.gt: 10}`
- Estilo string SQL: `{">": 10}`
- Estilo Sequelize string: `{"$gt": 10}`

O ORM normaliza automaticamente essas formas via `normalize_operator_key(...)`.

- `Op.eq` (`=`): igualdade exata.
  - Ex.: `{"SITUACAO": {Op.eq: "A"}}`
- `Op.ne` (`<>`): diferente de.
  - Ex.: `{"SITUACAO": {Op.ne: "I"}}`
- `Op.gt` (`>`): maior que.
  - Ex.: `{"ATO_ID": {Op.gt: 1000}}`
- `Op.gte` (`>=`): maior ou igual.
  - Ex.: `{"ATO_ID": {Op.gte: 1000}}`
- `Op.lt` (`<`): menor que.
  - Ex.: `{"ATO_ID": {Op.lt: 2000}}`
- `Op.lte` (`<=`): menor ou igual.
  - Ex.: `{"ATO_ID": {Op.lte: 2000}}`
- `Op.like` (`LIKE`): busca textual com coringas `%`.
  - Ex.: `{"LOGIN": {Op.like: "%SARA%"}}`
- `Op.notLike` (`NOT LIKE`): nega busca textual com `%`.
  - Ex.: `{"LOGIN": {Op.notLike: "%TESTE%"}}`
- `Op.in_` (`IN`): valor dentro de lista.
  - Ex.: `{"USUARIO_ID": {Op.in_: [1, 2, 3]}}`
- `Op.notIn` (`NOT IN`): valor fora de lista.
  - Ex.: `{"USUARIO_ID": {Op.notIn: [1, 2, 3]}}`
- `Op.between` (`BETWEEN`): intervalo inclusivo.
  - Ex.: `{"ATO_ID": {Op.between: [1000, 2000]}}`
- `Op.notBetween` (`NOT BETWEEN`): fora do intervalo.
  - Ex.: `{"ATO_ID": {Op.notBetween: [1000, 2000]}}`
- `Op.and_` (`AND`): combina multiplas condicoes obrigatorias.
  - Ex.: `{Op.and_: [{"SITUACAO": "A"}, {"PROTOCOLO": {Op.gt: 0}}]}`
- `Op.or_` (`OR`): combina condicoes alternativas.
  - Ex.: `{Op.or_: [{"SITUACAO": "A"}, {"SITUACAO": "P"}]}`
- `Op.is_` (`IS`): teste semantico, principalmente para `NULL`.
  - Ex.: `{"DATA_CANCELAMENTO": {Op.is_: None}}`
- `Op.not_` (`NOT`): negacao semantica, principalmente para `NULL`.
  - Ex.: `{"DATA_CANCELAMENTO": {Op.not_: None}}`

Aliases Sequelize-like disponiveis em `Op`:
- `Op.inOp` -> `Op.in_`
- `Op.andOp` -> `Op.and_`
- `Op.orOp` -> `Op.or_`

Exemplo completo com combinacao de operadores:

```python
rows = T_ATO.findAll(
    {
        "where": {
            Op.and_: [
                {"ATO_ID": {Op.gte: 1000}},
                {"ATO_ID": {Op.lte: 3000}},
                {
                    Op.or_: [
                        {"LOGIN": {Op.like: "%SARA%"}},
                        {"LOGIN": {Op.like: "%MARIA%"}},
                    ]
                },
                {"DATA_CANCELAMENTO": {Op.is_: None}},
                {"PROTOCOLO": {Op.notIn: [10, 20, 30]}},
            ]
        },
        "order": [("ATO_ID", "DESC")],
        "limit": 20,
    }
)
print(rows)
# Esperado: lista filtrada por intervalo + OR textual + IS NULL + NOT IN.
```

## Associacoes, include, include aninhado e separate

As associacoes no ORM Python seguem o registro de `src/orm_py/associations.py` via:
- `register_association(...)`
- `AssociationDefinition` com `type`, `as_name`, `foreign_key`, `source_key`, `target_key`, `through`, `other_key`.

Regras praticas:
- o alias (`as`) identifica a associacao no `include`.
- se `foreignKey` nao for informado, o ORM calcula automaticamente.
- para `belongsToMany`, voce pode informar `through` e `otherKey`.

### `belongsTo` (cardinalidade N:1)

Caso de uso:
- muitos atos (`T_ATO`) pertencem a um usuario (`G_USUARIO`).
- FK fica no model origem (`T_ATO`).

```python
T_ATO.belongsTo(
    G_USUARIO,
    {
        "as": "usuario",
        "foreignKey": "USUARIO_ID",   # coluna em T_ATO
        "targetKey": "USUARIO_ID",    # PK/UK em G_USUARIO
    },
)
```

Resposta esperada:
- cada `T_ATO` pode trazer um unico `usuario`.
- no include, `usuario` vem como objeto unico (ou `None`).

### `hasOne` (cardinalidade 1:1)

Caso de uso:
- um usuario possui exatamente um perfil de configuracao.
- FK normalmente fica no model alvo.

```python
G_USUARIO.hasOne(
    G_USUARIO_CONFIG,
    {
        "as": "config",
        "foreignKey": "USUARIO_ID",   # coluna em G_USUARIO_CONFIG
        "sourceKey": "USUARIO_ID",    # coluna em G_USUARIO
    },
)
```

Resposta esperada:
- cada usuario retorna no maximo um `config`.
- no include, `config` vem como objeto unico (ou `None`).

### `hasMany` (cardinalidade 1:N)

Caso de uso:
- um usuario possui muitos atos.
- FK fica no model filho (`T_ATO`), apontando para o pai (`G_USUARIO`).

```python
G_USUARIO.hasMany(
    T_ATO,
    {
        "as": "atos",
        "foreignKey": "USUARIO_ID",   # coluna em T_ATO
        "sourceKey": "USUARIO_ID",    # coluna em G_USUARIO
    },
)
```

Resposta esperada:
- no include, `atos` vem como lista.
- cardinalidade: 1 usuario -> N atos.

### `belongsToMany` (cardinalidade N:N)

Caso de uso:
- um usuario participa de varios grupos e um grupo tem varios usuarios.
- exige tabela intermediaria (`through`).

```python
G_USUARIO.belongsToMany(
    G_GRUPO,
    {
        "as": "grupos",
        "through": G_USUARIO_GRUPO,   # tabela de juncao
        "foreignKey": "USUARIO_ID",   # chave da origem na juncao
        "otherKey": "GRUPO_ID",       # chave do alvo na juncao
    },
)
```

Resposta esperada:
- no include, `grupos` vem como lista.
- cardinalidade: N usuarios <-> N grupos.

### Include simples (exemplo real com `belongsTo`)

```python
ato = T_ATO.findOne(
    {
        "where": {"ATO_ID": 1000},
        "include": [
            {
                "association": "usuario",
                "required": False,
                "attributes": ["USUARIO_ID", "LOGIN", "NOME_COMPLETO"],
            }
        ],
    }
)
print(ato)
# Esperado: ato com chave "usuario" aninhada (ou None).
```

### Include aninhado (multinivel)

```python
rows = T_ATO.findAll(
    {
        "limit": 10,
        "include": [
            {
                "association": "usuario",
                "include": [
                    {
                        "association": "perfil",
                    }
                ],
            }
        ],
    }
)
# Esperado: estrutura aninhada usuario.perfil no payload.
```

### Include com `separate: true` (alto volume em relacao N)

Quando usar:
- relacao `hasMany` ou `belongsToMany` com muito filho por pai.
- evita explosao cartesiana de join unico.

```python
usuarios = G_USUARIO.findAll(
    {
        "where": {"SITUACAO": "A"},
        "include": [
            {
                "association": "atos",
                "separate": True,
                "order": [("ATO_ID", "DESC")],
                "limit": 20,
            }
        ],
    }
)
# Esperado: consulta principal de usuarios + consulta separada para "atos".
```

Comparacao:
- Mesmo conceito da versao TS para joins e carga separada em relacoes de alto volume.

## Hooks

Hooks sao eventos de ciclo de vida registrados por model e executados pelo motor de `src/orm_py/query/hooks.py`.

No Python ORM, os nomes oficiais sao:
- `beforeCreate`, `afterCreate`
- `beforeUpdate`, `afterUpdate`
- `beforeSave`, `afterSave`
- `beforeDestroy`, `afterDestroy`

Tambem sao aceitos aliases `snake_case` no registrador interno:
- `before_create`, `after_create`
- `before_update`, `after_update`
- `before_save`, `after_save`
- `before_destroy`, `after_destroy`

### Fluxo de execucao por operacao

- `create()`:
  1. `beforeCreate`
  2. `beforeSave`
  3. persistencia
  4. `afterCreate`
  5. `afterSave`
- `save()`:
  - quando `isNewRecord=True`: mesmo fluxo do `create`.
  - quando `isNewRecord=False`: `beforeUpdate` -> `beforeSave` -> persistencia -> `afterUpdate` -> `afterSave`.
- `destroy()` / `destroy_instance()`:
  1. `beforeDestroy`
  2. exclusao
  3. `afterDestroy`

Caso de uso pratico:
- preencher defaults de negocio antes de salvar.
- validar regra (ex.: bloquear status invalido) antes de atualizar.
- registrar auditoria apos create/update/destroy sem duplicar codigo.

### Exemplo de registro e rastreio de hooks

```python
from orm_py.query.hooks import before_create, after_create, before_save, after_save

events = []

def on_before_create(instance):
    events.append("beforeCreate")

def on_after_create(instance):
    events.append("afterCreate")

def on_before_save(instance):
    events.append("beforeSave")

def on_after_save(instance):
    events.append("afterSave")

def before_update(instance):
    events.append("beforeUpdate")

def after_update(instance):
    events.append("afterUpdate")

def before_destroy(instance):
    events.append("beforeDestroy")

def after_destroy(instance):
    events.append("afterDestroy")

# Novo atalho: basta passar (model, handler)
before_create(G_USUARIO, on_before_create)
after_create(G_USUARIO, on_after_create)
before_save(G_USUARIO, on_before_save)
after_save(G_USUARIO, on_after_save)

# Continua valendo a API do model:
# G_USUARIO.beforeCreate(on_before_create)
# G_USUARIO.afterCreate(on_after_create)
# G_USUARIO.beforeSave(on_before_save)
# G_USUARIO.afterSave(on_after_save)

G_USUARIO.beforeUpdate(before_update)
G_USUARIO.afterUpdate(after_update)
G_USUARIO.beforeDestroy(before_destroy)
G_USUARIO.afterDestroy(after_destroy)

created = G_USUARIO.create({"USUARIO_ID": 992000})
print(created)
print(events)
# Esperado no create: ["beforeCreate", "beforeSave", "afterCreate", "afterSave"].
```

### Modo decorador (ainda mais curto)

```python
from orm_py.query.hooks import before_create

@before_create(G_USUARIO)
def preencher_login_padrao(instance):
    if instance.get("LOGIN") is None:
        instance.set("LOGIN", "USR_PADRAO")
```

### Exemplo de regra com erro (bloqueio no hook)

```python
def bloquear_login_vazio(instance):
    login = instance.get("LOGIN")
    if login is None or str(login).strip() == "":
        raise ValueError("LOGIN obrigatorio para persistir usuario.")

G_USUARIO.beforeSave(bloquear_login_vazio)

# Usuario sem LOGIN vai falhar antes de gravar no banco.
G_USUARIO.create({"USUARIO_ID": 992001, "LOGIN": ""})
```

Resposta esperada:
- excecao levantada no `beforeSave`.
- insert/update nao e executado.
- erro final chega encapsulado na camada de erro do ORM.

## Schemas (QueryInterface)

No Python, a camada de schema fica em `orm_py.schema.query_interface.QueryInterface`.

```python
from orm_py.schema.query_interface import QueryInterface
from dataclasses import asdict

qi = QueryInterface(orm.get_connection())

tables = qi.list_tables()
exists = qi.table_exists("T_ATO")
fks = qi.list_foreign_keys()
desc = qi.describe_table("T_ATO")

print(tables[:5])
print(exists)
print(len(fks))
print(asdict(desc[0]) if desc else None)
```

Resposta esperada:
- `list_tables()`: lista de tabelas de usuario.
- `table_exists(name)`: booleano.
- `list_foreign_keys()`: lista de FKs.
- `describe_table(table)`: lista de colunas com tipo/nullable/default/posicao.

Comparacao de nomenclatura com o padrao TS:
- TS `listTables` -> PY `list_tables`
- TS `tableExists` -> PY `table_exists`
- TS `listForeignKeys` -> PY `list_foreign_keys`
- TS `describeTable` -> PY `describe_table`

Tambem disponiveis no QueryInterface:
- `list_schemas`
- `show_constraints`
- `show_indexes`
- `create_table`
- `drop_table`
- `truncate_table`
- `rename_table`
- `remove_index`
- `add_foreign_key`

## Observacoes finais

- O foco do ORM Python e manter paridade de uso com o padrao Sequelize-like da versao TypeScript.
- Quando houver divergencia de dialeto Firebird (ex.: bind/cast em cenarios especificos), o ORM aplica tratativas para manter API consistente.
- Para payload externo, prefira sempre respostas ja serializadas via funcoes do ORM e `to_json_response`.
