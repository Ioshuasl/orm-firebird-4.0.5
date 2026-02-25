# ORM (Firebird Node.js)

O **ORM** é um mapeador objeto-relacional (ORM) leve e modular, desenvolvido em TypeScript, projetado especificamente para o banco de dados **Firebird 4.0.5**. Ele oferece uma sintaxe amigável, inspirada no Sequelize, para gerenciar modelos, persistência e consultas complexas.

## 🚀 Principais Funcionalidades

### 1. Núcleo e Conexão

* **Gerenciamento de Pool**: Utiliza o `node-firebird` com um sistema de pool de conexões eficiente, garantindo a devolução automática ao pool via `detach()`.
* **Suporte a Firebird 4.0**: Configurado para trabalhar com **Alias** (definido no `databases.conf`), evitando a exposição de caminhos físicos.
* **Sintaxe ANSI**: Implementa paginação moderna usando `OFFSET` e `FETCH FIRST`, otimizada para a versão 4.0 do motor.

### 2. Definição de Modelos (Schema)

* **Mapeamento de Tipos**: Suporte a diversos `DataTypes`, incluindo `STRING`, `INTEGER`, `BIGINT`, `TEXT` (BLOB), `BINARY` (BLOB), `TIMESTAMP` e `DECIMAL`.
* **Hidratação de Dados**: Converte automaticamente **Streams de BLOB** (comuns no Firebird) em strings ou buffers utilizáveis pelo Node.js.
* **Smart Table Reference**: Permite referenciar tabelas tanto pelo nome em string quanto pela classe do Modelo.

### 3. Persistência de Dados (Active Record)

* **Método `save()` Inteligente**: Identifica automaticamente se deve realizar um `INSERT` ou `UPDATE` baseado na presença da chave primária.
* **Auto-Incremento Híbrido**:
* Suporte nativo a colunas `IDENTITY`.
* Suporte a **Generators/Sequences** através da propriedade `sequence` no schema.
* **Fallback Automático**: Caso não haja suporte nativo ou generator, o ORM calcula o próximo ID via `MAX(ID) + 1`.


* **Sincronização Imediata**: Utiliza a cláusula `RETURNING *` para atualizar a instância local com dados gerados pelo banco logo após a gravação.

### 4. Consultas e Filtros

* **Operadores Estilo Sequelize**: Suporte a `Op.eq`, `Op.ne`, `Op.gt`, `Op.between`, `Op.like`, `Op.in`, entre outros.
* **Consultas Avançadas**:
* `findAll()` e `findOne()` com suporte a `where`, `limit`, `offset`, `order` e `attributes`.
* `count()` para facilitar a paginação no frontend.


* **Associações (Include)**: Suporte a `LEFT JOIN` com gerenciamento automático de aliases (`T1`, `J1`) para evitar nomes de colunas ambíguos.

## 🛠️ Ferramentas de Utilidade (CLI)

O projeto conta com scripts utilitários para facilitar o desenvolvimento:

* **`npm run discover`**: Lista todos os Generators (Sequences) existentes no banco.
* **`npm run hunt`**: Analisa as Triggers de uma tabela para descobrir qual contador ela utiliza.
* **`npm run metadata`**: Extrai toda a estrutura do banco para um arquivo `db.json`.

## 💻 Exemplo de Uso

### Definindo um Modelo

```typescript
export class Ato extends Model {
    protected static tableName = 'T_ATO';
    protected static primaryKey = 'ATO_ID';
    protected static schema = {
        ATO_ID: { type: DataType.BIGINT, primaryKey: true, autoIncrement: true },
        TEXTO: { type: DataType.TEXT },
        VALOR_PAGAMENTO: { type: DataType.DECIMAL }
    };
}

```

### Consultando com Filtros Complexos

```typescript
const atos = await Ato.findAll({
    where: {
        ATO_ID: { [Op.between]: [4000, 5000] },
        SITUACAO_ATO: '3'
    },
    order: [['ATO_ID', 'DESC']],
    limit: 10
});

```

---

Com este `README.md`, seu projeto já tem uma cara bem profissional. **Gostaria que eu preparasse agora o código para a funcionalidade de Transações, para dar mais segurança ao salvar seus Atos e Selos?**