# Guia de Debug com `isql.exe` (Firebird 4)

Este guia mostra como usar o `isql.exe` para:

- debugar/inspecionar **todas as tabelas** do banco;
- debugar **uma tabela especifica**;
- configurar output para **tela**, **arquivo `.txt`** e **arquivo `.json`**.

## 1) Executavel e conexao

Caminho do `isql`:

```powershell
"C:\Program Files\Firebird\Firebird_4_0\isql.exe"
```

Exemplo de conexao direta:

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" -user SYSDBA -password masterkey localhost/3050:C:\caminho\meu_banco.fdb
```

Se abrir o prompt `SQL>`, voce conectou com sucesso.

## 2) Comandos uteis de "debug" dentro do ISQL

No prompt `SQL>`, estes comandos ajudam na investigacao:

```sql
SET LIST ON;      -- mostra resultado em formato campo=valor
SET HEADING ON;   -- mostra cabecalho das colunas
SET ECHO ON;      -- mostra os comandos executados
SET STATS ON;     -- mostra estatisticas de execucao
SET PLAN ON;      -- mostra plano de execucao
SET COUNT ON;     -- mostra quantidade de linhas retornadas
SET BAIL ON;      -- para na primeira falha
```

Para voltar ao padrao:

```sql
SET LIST OFF;
SET STATS OFF;
SET PLAN OFF;
SET COUNT OFF;
SET ECHO OFF;
```

## 3) Debugar todas as tabelas

### 3.1 Listar nomes de tabelas de usuario

```sql
SELECT TRIM(rdb$relation_name) AS table_name
FROM rdb$relations
WHERE rdb$system_flag = 0
  AND COALESCE(rdb$view_blr, '') = ''
ORDER BY 1;
```

### 3.2 Gerar SQL para contar linhas de todas as tabelas

Esse select gera outro script SQL com `COUNT(*)` para cada tabela:

```sql
SELECT
  'SELECT ''' || TRIM(rdb$relation_name) || ''' AS table_name, COUNT(*) AS total FROM "' ||
  TRIM(rdb$relation_name) || '";' AS sql_to_run
FROM rdb$relations
WHERE rdb$system_flag = 0
  AND COALESCE(rdb$view_blr, '') = ''
ORDER BY 1;
```

Fluxo recomendado:

1. Rode a query acima;
2. Copie a coluna `sql_to_run`;
3. Execute os `SELECT ... COUNT(*) ...` gerados para ver volume de todas as tabelas.

### 3.3 Inspecionar estrutura (campos) de todas as tabelas

```sql
SELECT
  TRIM(rf.rdb$relation_name) AS table_name,
  TRIM(rf.rdb$field_name) AS field_name,
  f.rdb$field_type AS field_type_code,
  f.rdb$field_length AS field_length,
  rf.rdb$null_flag AS not_null_flag
FROM rdb$relation_fields rf
JOIN rdb$fields f ON f.rdb$field_name = rf.rdb$field_source
WHERE rf.rdb$relation_name IN (
  SELECT rdb$relation_name
  FROM rdb$relations
  WHERE rdb$system_flag = 0
    AND COALESCE(rdb$view_blr, '') = ''
)
ORDER BY 1, rf.rdb$field_position;
```

## 4) Debugar uma tabela especifica

Troque `G_USUARIO` pelo nome desejado.

### 4.1 Estrutura da tabela

```sql
SELECT
  TRIM(rf.rdb$field_name) AS field_name,
  f.rdb$field_type AS field_type_code,
  f.rdb$field_length AS field_length,
  rf.rdb$null_flag AS not_null_flag
FROM rdb$relation_fields rf
JOIN rdb$fields f ON f.rdb$field_name = rf.rdb$field_source
WHERE rf.rdb$relation_name = 'G_USUARIO'
ORDER BY rf.rdb$field_position;
```

### 4.2 Amostra de dados

```sql
SELECT FIRST 50 * FROM G_USUARIO;
```

### 4.3 Total de registros

```sql
SELECT COUNT(*) AS total FROM G_USUARIO;
```

### 4.4 Ver plano para query da tabela

```sql
SET PLAN ON;
SELECT FIRST 50 * FROM G_USUARIO WHERE ID_USUARIO = 1;
```

## 5) Configurando output

## 5.1 Output na tela (padrao)

Basta executar normalmente no `SQL>`.

## 5.2 Output para arquivo `.txt` (mais simples)

No PowerShell:

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" `
  -user SYSDBA `
  -password masterkey `
  localhost/3050:C:\caminho\meu_banco.fdb `
  -i .\script_debug.sql `
  -o .\saida_debug.txt
```

Onde `script_debug.sql` contem seus `SET ...` e `SELECT ...`.

Exemplo de `script_debug.sql`:

```sql
SET LIST ON;
SET HEADING ON;
SET COUNT ON;

SELECT FIRST 20 * FROM G_USUARIO;
SELECT COUNT(*) AS total FROM G_USUARIO;
```

## 5.3 Output para JSON

O `isql` **nao gera JSON nativo** diretamente. O caminho pratico e:

1. gerar saida texto (preferencialmente com `SET LIST ON`);
2. converter para JSON com script externo (PowerShell, Python, Node.js).

Exemplo rapido com Python (apos gerar `saida_debug.txt`):

```powershell
python -c "import json; import pathlib; txt=pathlib.Path('saida_debug.txt').read_text(encoding='utf-8', errors='ignore'); pathlib.Path('saida_debug.json').write_text(json.dumps({'raw': txt}, ensure_ascii=False, indent=2), encoding='utf-8')"
```

Isso encapsula o conteudo em JSON (`raw`). Para JSON estruturado por colunas, use um parser customizado conforme o formato de saida escolhido (`SET LIST ON` ou tabular).

## 6) Script base reutilizavel de debug

Crie um arquivo `debug_base.sql`:

```sql
SET SQL DIALECT 3;
SET NAMES UTF8;
SET BAIL ON;
SET ECHO ON;
SET LIST ON;
SET HEADING ON;
SET PLAN ON;
SET STATS ON;
SET COUNT ON;

-- Troque a tabela conforme necessidade:
SELECT FIRST 50 * FROM G_USUARIO;
SELECT COUNT(*) AS total FROM G_USUARIO;
```

Executar e salvar em TXT:

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" -user SYSDBA -password masterkey localhost/3050:C:\caminho\meu_banco.fdb -i .\debug_base.sql -o .\debug_base_out.txt
```

---

Se quiser, posso criar tambem um `debug_all_tables.sql` pronto com geracao de contagem para todas as tabelas e um script PowerShell para converter a saida em JSON estruturado.

## 7) Gerar estrutura JSON no padrao do `db.json` (tabela/colunas)

No trecho de exemplo do seu `db.json`, o padrao por coluna e:

- `nome`
- `tipo`
- `tamanho`
- `precisao`
- `escala`
- `obrigatorio`
- `auto_increment`
- `default_value`
- `primary_key`
- `fk` (`null` ou objeto com `referencia_tabela` e `referencia_coluna`)

Para montar isso via `isql`, o fluxo mais estavel e:

1. extrair metadados tecnicos do Firebird para um `.txt` delimitado por `|`;
2. converter esse `.txt` para JSON agrupado por tabela no PowerShell.

### 7.1 SQL de metadados (salve em `meta_schema.sql`)

```sql
SET LIST OFF;
SET HEADING OFF;
SET ECHO OFF;
SET COUNT OFF;
SET TERM ^ ;
EXECUTE BLOCK RETURNS (line VARCHAR(8191)) AS BEGIN FOR SELECT TRIM(rf.rdb$relation_name) || '|' || TRIM(rf.rdb$field_name) || '|' || CASE f.rdb$field_type WHEN 7 THEN IIF(f.rdb$field_sub_type = 1, 'NUMERIC', IIF(f.rdb$field_sub_type = 2, 'DECIMAL', 'SMALLINT')) WHEN 8 THEN IIF(f.rdb$field_sub_type = 1, 'NUMERIC', IIF(f.rdb$field_sub_type = 2, 'DECIMAL', 'INTEGER')) WHEN 10 THEN 'FLOAT' WHEN 12 THEN 'DATE' WHEN 13 THEN 'TIME' WHEN 14 THEN 'CHAR' WHEN 16 THEN IIF(f.rdb$field_sub_type = 1, 'NUMERIC', IIF(f.rdb$field_sub_type = 2, 'DECIMAL', 'BIGINT')) WHEN 23 THEN 'BOOLEAN' WHEN 24 THEN 'DECFLOAT(16)' WHEN 25 THEN 'DECFLOAT(34)' WHEN 26 THEN 'INT128' WHEN 27 THEN 'DOUBLE PRECISION' WHEN 28 THEN 'TIME WITH TIME ZONE' WHEN 29 THEN 'TIMESTAMP WITH TIME ZONE' WHEN 35 THEN 'TIMESTAMP' WHEN 37 THEN 'VARCHAR' WHEN 261 THEN 'BLOB' ELSE 'UNKNOWN' END || '|' || COALESCE(CAST(COALESCE(f.rdb$character_length, f.rdb$field_length, 0) AS VARCHAR(20)), '0') || '|' || COALESCE(CAST(COALESCE(f.rdb$field_precision, 0) AS VARCHAR(20)), '0') || '|' || COALESCE(CAST(ABS(COALESCE(f.rdb$field_scale, 0)) AS VARCHAR(20)), '0') || '|' || COALESCE(CAST(COALESCE(f.rdb$field_sub_type, 0) AS VARCHAR(20)), '0') || '|' || IIF(rf.rdb$null_flag = 1, 'true', 'false') || '|' || IIF(rf.rdb$identity_type IS NOT NULL OR UPPER(COALESCE(rf.rdb$default_source, f.rdb$default_source, '')) CONTAINING 'NEXT VALUE FOR', 'true', 'false') || '|' || REPLACE(REPLACE(COALESCE(TRIM(rf.rdb$default_source), TRIM(f.rdb$default_source), ''), ASCII_CHAR(13), ' '), ASCII_CHAR(10), ' ') || '|' || IIF(pk.field_name IS NOT NULL, 'true', 'false') || '|' || COALESCE(fk.ref_table, '') || '|' || COALESCE(fk.ref_field, '') FROM rdb$relation_fields rf JOIN rdb$fields f ON f.rdb$field_name = rf.rdb$field_source LEFT JOIN (SELECT TRIM(isc.rdb$relation_name) rel_name, TRIM(ise.rdb$field_name) field_name FROM rdb$relation_constraints isc JOIN rdb$index_segments ise ON ise.rdb$index_name = isc.rdb$index_name WHERE isc.rdb$constraint_type = 'PRIMARY KEY') pk ON pk.rel_name = TRIM(rf.rdb$relation_name) AND pk.field_name = TRIM(rf.rdb$field_name) LEFT JOIN (SELECT TRIM(src_seg.rdb$field_name) field_name, TRIM(src_rel.rdb$relation_name) rel_name, TRIM(trg_rel.rdb$relation_name) ref_table, TRIM(trg_seg.rdb$field_name) ref_field FROM rdb$relation_constraints src_rel JOIN rdb$ref_constraints refc ON refc.rdb$constraint_name = src_rel.rdb$constraint_name JOIN rdb$relation_constraints trg_rel ON trg_rel.rdb$constraint_name = refc.rdb$const_name_uq JOIN rdb$index_segments src_seg ON src_seg.rdb$index_name = src_rel.rdb$index_name JOIN rdb$index_segments trg_seg ON trg_seg.rdb$index_name = trg_rel.rdb$index_name AND trg_seg.rdb$field_position = src_seg.rdb$field_position WHERE src_rel.rdb$constraint_type = 'FOREIGN KEY') fk ON fk.rel_name = TRIM(rf.rdb$relation_name) AND fk.field_name = TRIM(rf.rdb$field_name) WHERE EXISTS (SELECT 1 FROM rdb$relations r WHERE r.rdb$relation_name = rf.rdb$relation_name AND r.rdb$system_flag = 0 AND COALESCE(r.rdb$view_blr, '') = '') ORDER BY 1, rf.rdb$field_position INTO :line DO SUSPEND; END^
SET TERM ; ^
```

### 7.2 Extrair metadados de TODAS as tabelas para TXT (PowerShell, uma linha)

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" -user SYSDBA -password masterkey "localhost/3050:C:\caminho\meu_banco.fdb" -i ".\meta_schema.sql" -o ".\meta_schema_all.txt"
```

### 7.3 Extrair metadados de UMA tabela especifica (PowerShell, uma linha)

Crie antes `meta_schema_one_table.sql` com a mesma query da secao 7.1 adicionando no `WHERE` final: `AND TRIM(rf.rdb$relation_name) = 'T_ATO'`.

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" -user SYSDBA -password masterkey "localhost/3050:C:\caminho\meu_banco.fdb" -i ".\meta_schema_one_table.sql" -o ".\meta_schema_T_ATO.txt"
```

### 7.4 Converter TXT para JSON no mesmo padrao do `db.json` (PowerShell, uma linha)

Comando para converter o dump de **todas** as tabelas:

```powershell
$rows=Get-Content ".\meta_schema_all.txt" | Where-Object { $_ -and ($_ -like '*|*') }; $db=@{}; foreach($r in $rows){ $p=$r.Split('|'); if($p.Count -lt 13){ continue }; $t=$p[0].Trim(); $n=$p[1].Trim(); $tipo=$p[2].Trim(); $tam=[int]($p[3]); $prec=[int]($p[4]); $esc=[int]($p[5]); $sub=[int]($p[6]); $ob=($p[7].Trim().ToLower() -eq 'true'); $ai=($p[8].Trim().ToLower() -eq 'true'); $def=if([string]::IsNullOrWhiteSpace($p[9])){$null}else{$p[9].Trim()}; $pk=($p[10].Trim().ToLower() -eq 'true'); $rt=if($p.Count -gt 11){$p[11].Trim()}else{''}; $rc=if($p.Count -gt 12){$p[12].Trim()}else{''}; $fk=if([string]::IsNullOrWhiteSpace($rt) -or [string]::IsNullOrWhiteSpace($rc)){$null}else@{ referencia_tabela=$rt; referencia_coluna=$rc }; if(-not $db.ContainsKey($t)){ $db[$t]=@{ tabela=$t; colunas=@() } }; $db[$t].colunas += [ordered]@{ nome=$n; tipo=$tipo; tamanho=$tam; precisao=$prec; escala=$esc; subtipo=$sub; obrigatorio=$ob; auto_increment=$ai; default_value=$def; primary_key=$pk; fk=$fk } }; $db | ConvertTo-Json -Depth 10 | Set-Content ".\db_schema_debug.json" -Encoding UTF8
```

Para converter o dump de uma tabela especifica, troque apenas o arquivo de entrada (`meta_schema_T_ATO.txt`) e de saida.

### 7.5 Comando equivalente no CMD (uma linha)

```cmd
"C:\Program Files\Firebird\Firebird_4_0\isql.exe" -user SYSDBA -password masterkey "localhost/3050:C:\caminho\meu_banco.fdb" -i ".\meta_schema.sql" -o ".\meta_schema_all.txt"
```

### 7.6 Validacao rapida

Depois de gerar `db_schema_debug.json`, valide uma tabela:

```powershell
(Get-Content ".\db_schema_debug.json" -Raw | ConvertFrom-Json)."T_ATO" | ConvertTo-Json -Depth 10
```

Isso deve retornar estrutura no mesmo estilo do seu `db.json`, com nome da tabela e array de colunas com os atributos tecnicos para debug.

## 8) Filtrar procedures, triggers e sequencias (isql)

Sim, com `isql.exe` voce consegue filtrar:

- todas as procedures;
- todas as triggers;
- triggers vinculadas a tabela;
- sequencias (`generators`).

### 8.1 Listar todas as procedures

```sql
SELECT TRIM(p.RDB$PROCEDURE_NAME) AS PROCEDURE_NAME, COALESCE(p.RDB$VALID_BLR, 0) AS VALID_BLR FROM RDB$PROCEDURES p WHERE COALESCE(p.RDB$SYSTEM_FLAG, 0) = 0 ORDER BY 1;
```

### 8.2 Listar todas as triggers (inclusive de banco e de tabela)

```sql
SELECT TRIM(t.RDB$TRIGGER_NAME) AS TRIGGER_NAME, TRIM(t.RDB$RELATION_NAME) AS TABLE_NAME, COALESCE(t.RDB$TRIGGER_INACTIVE, 0) AS INACTIVE, COALESCE(t.RDB$VALID_BLR, 0) AS VALID_BLR, COALESCE(t.RDB$TRIGGER_TYPE, -1) AS TRIGGER_TYPE FROM RDB$TRIGGERS t WHERE COALESCE(t.RDB$SYSTEM_FLAG, 0) = 0 ORDER BY 2, 1;
```

### 8.3 Listar somente triggers de tabela

```sql
SELECT TRIM(t.RDB$TRIGGER_NAME) AS TRIGGER_NAME, TRIM(t.RDB$RELATION_NAME) AS TABLE_NAME, COALESCE(t.RDB$TRIGGER_INACTIVE, 0) AS INACTIVE, COALESCE(t.RDB$VALID_BLR, 0) AS VALID_BLR FROM RDB$TRIGGERS t WHERE COALESCE(t.RDB$SYSTEM_FLAG, 0) = 0 AND t.RDB$RELATION_NAME IS NOT NULL ORDER BY 2, 1;
```

### 8.4 Listar somente triggers de banco (database triggers)

```sql
SELECT TRIM(t.RDB$TRIGGER_NAME) AS TRIGGER_NAME, COALESCE(t.RDB$TRIGGER_INACTIVE, 0) AS INACTIVE, COALESCE(t.RDB$VALID_BLR, 0) AS VALID_BLR, COALESCE(t.RDB$TRIGGER_TYPE, -1) AS TRIGGER_TYPE FROM RDB$TRIGGERS t WHERE COALESCE(t.RDB$SYSTEM_FLAG, 0) = 0 AND t.RDB$RELATION_NAME IS NULL ORDER BY 1;
```

### 8.5 Listar sequencias (generators)

```sql
SELECT TRIM(g.RDB$GENERATOR_NAME) AS SEQUENCE_NAME, COALESCE(g.RDB$INITIAL_VALUE, 0) AS INITIAL_VALUE, COALESCE(g.RDB$GENERATOR_INCREMENT, 1) AS INCREMENT_BY FROM RDB$GENERATORS g WHERE COALESCE(g.RDB$SYSTEM_FLAG, 0) = 0 ORDER BY 1;
```

## 9) Integridade de procedures/triggers: como garantir

Importante: em banco de dados, "garantia 100%" so existe com verificacao recorrente (monitoramento + testes).  
Com `isql` voce consegue uma **garantia operacional forte** validando:

- objetos com `RDB$VALID_BLR = 0` (objeto invalido/quebrado);
- triggers inativas (`RDB$TRIGGER_INACTIVE = 1`);
- existencia de erros ao recompilar objetos;
- execucao de smoke tests de regras criticas.

### 9.1 Auditoria rapida de inconsistencias (uma linha)

```sql
SELECT 'PROCEDURE' AS OBJ_TYPE, TRIM(p.RDB$PROCEDURE_NAME) AS OBJ_NAME, IIF(COALESCE(p.RDB$VALID_BLR, 0) = 1, 'OK', 'INVALID') AS STATUS FROM RDB$PROCEDURES p WHERE COALESCE(p.RDB$SYSTEM_FLAG, 0) = 0 UNION ALL SELECT 'TRIGGER' AS OBJ_TYPE, TRIM(t.RDB$TRIGGER_NAME) AS OBJ_NAME, IIF(COALESCE(t.RDB$VALID_BLR, 0) = 1 AND COALESCE(t.RDB$TRIGGER_INACTIVE, 0) = 0, 'OK', IIF(COALESCE(t.RDB$VALID_BLR, 0) = 0, 'INVALID', 'INACTIVE')) AS STATUS FROM RDB$TRIGGERS t WHERE COALESCE(t.RDB$SYSTEM_FLAG, 0) = 0 ORDER BY 1, 2;
```

### 9.2 Mostrar somente problemas (uma linha)

```sql
SELECT 'PROCEDURE' AS OBJ_TYPE, TRIM(p.RDB$PROCEDURE_NAME) AS OBJ_NAME, 'INVALID' AS ISSUE FROM RDB$PROCEDURES p WHERE COALESCE(p.RDB$SYSTEM_FLAG, 0) = 0 AND COALESCE(p.RDB$VALID_BLR, 0) = 0 UNION ALL SELECT 'TRIGGER' AS OBJ_TYPE, TRIM(t.RDB$TRIGGER_NAME) AS OBJ_NAME, IIF(COALESCE(t.RDB$VALID_BLR, 0) = 0, 'INVALID', 'INACTIVE') AS ISSUE FROM RDB$TRIGGERS t WHERE COALESCE(t.RDB$SYSTEM_FLAG, 0) = 0 AND (COALESCE(t.RDB$VALID_BLR, 0) = 0 OR COALESCE(t.RDB$TRIGGER_INACTIVE, 0) = 1) ORDER BY 1, 2;
```

### 9.3 Exportar auditoria para TXT (PowerShell, uma linha)

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" -user SYSDBA -password masterkey "localhost/3050:C:\caminho\meu_banco.fdb" -i ".\auditoria_objetos.sql" -o ".\auditoria_objetos.txt"
```

### 9.4 Exportar auditoria para JSON (PowerShell, uma linha)

```powershell
$rows=Get-Content ".\auditoria_objetos.txt" | Where-Object { $_ -match '^(PROCEDURE|TRIGGER)\s+' }; $out=@(); foreach($r in $rows){ $parts=$r -split '\s{2,}'; if($parts.Count -ge 3){ $out += [ordered]@{ tipo=$parts[0].Trim(); nome=$parts[1].Trim(); status=$parts[2].Trim() } } }; $out | ConvertTo-Json -Depth 5 | Set-Content ".\auditoria_objetos.json" -Encoding UTF8
```

### 9.5 Checklist de garantia operacional

- rode a query de problemas e confirme resultado vazio;
- mantenha triggers necessarias com `INACTIVE = 0`;
- gere `auditoria_objetos.txt` em cada deploy;
- compare com auditoria anterior (diff) para detectar regressao;
- execute testes funcionais das regras que dependem de procedure/trigger.

## 10) Extrair codigo SQL completo (DDL/source)

Se voce precisa do SQL completo (como no exemplo de `CREATE OR ALTER PROCEDURE ...`), use o extrator de metadata do `isql`:

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" -user SYSDBA -password SUA_SENHA -x "HOST/PORT:ALIAS_OU_CAMINHO_FDB" -o ".\metadata_extract_full.sql"
```

Esse arquivo traz o DDL completo do banco, incluindo:

- procedures (cabecalho e corpo SQL);
- triggers (tabela e banco);
- generators/sequencias;
- demais objetos (tabelas, dominios, constraints, etc.).

Para focar somente em procedures/triggers/sequencias, filtre o arquivo extraido por:

- `ALTER PROCEDURE` (corpo SQL das procedures);
- `CREATE TRIGGER` (corpo SQL das triggers);
- `CREATE GENERATOR` (DDL das sequencias).

### 10.1 Comando exato usado no teste (seu banco)

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" -user SYSDBA -password 302b3c -x "192.168.1.100/3050:santarita" -o ".\metadata_extract_full.sql"
```

### 10.2 Esse comando extrai tudo do banco?

Sim. O `-x` exporta um snapshot de metadata/DDL do banco, incluindo normalmente:

- definicoes de tabelas e colunas;
- dominios;
- constraints (PK/FK/UNIQUE/CHECK);
- indices;
- procedures (cabecalho e corpo SQL);
- triggers (tabela e banco);
- generators/sequencias;
- views (quando existirem) e outros objetos de schema.

Em outras palavras: o `metadata_extract_full.sql` e um dump de estrutura do banco (schema), nao de dados.

### 10.3 Variacao para CMD (uma linha)

```cmd
"C:\Program Files\Firebird\Firebird_4_0\isql.exe" -user SYSDBA -password 302b3c -x "192.168.1.100/3050:santarita" -o ".\metadata_extract_full.sql"
```

### 10.4 Comando "melhorado" para reduzir divergencia com DBeaver

Quando houver diferenca de tipos/colunas na comparacao, prefira:

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" -ch UTF8 -user SYSDBA -password 302b3c -role RDB$ADMIN -x "192.168.1.100/3050:santarita" -o ".\metadata_extract_full_utf8.sql"
```

Motivos:

- `-ch UTF8`: evita leitura com charset diferente;
- `-role RDB$ADMIN`: evita diferencas por permissao/visibilidade;
- `-x`: exporta metadata completo do schema.

## 10.5 Por que ainda pode diferir do DBeaver?

Mesmo com `-x`, pode haver diferenca visual porque:

- o `isql` pode mostrar coluna via **DOMAIN** (ex.: `VARCHAR_030`);
- o DBeaver costuma mostrar tipo **expandido** (ex.: `VARCHAR(30)`);
- defaults/collation/computed podem aparecer formatados de forma diferente;
- versao do `isql` cliente diferente da versao real do servidor pode mudar formatacao.

Recomendacao forte: usar `isql.exe` da **mesma major version do servidor Firebird**.

## 10.6 Comparacao fiel de colunas (normalizada, estilo DBeaver)

Para validar coluna a coluna sem ambiguidade de domain, gere um dump normalizado:

1) Salve como `schema_columns_normalized.sql`:

```sql
SET LIST ON;
SET HEADING ON;
SET COUNT ON;
SELECT TRIM(rf.RDB$RELATION_NAME) AS TABLE_NAME, TRIM(rf.RDB$FIELD_NAME) AS COLUMN_NAME, CASE f.RDB$FIELD_TYPE WHEN 7 THEN IIF(f.RDB$FIELD_SUB_TYPE = 1, 'NUMERIC', IIF(f.RDB$FIELD_SUB_TYPE = 2, 'DECIMAL', 'SMALLINT')) WHEN 8 THEN IIF(f.RDB$FIELD_SUB_TYPE = 1, 'NUMERIC', IIF(f.RDB$FIELD_SUB_TYPE = 2, 'DECIMAL', 'INTEGER')) WHEN 10 THEN 'FLOAT' WHEN 12 THEN 'DATE' WHEN 13 THEN 'TIME' WHEN 14 THEN 'CHAR' WHEN 16 THEN IIF(f.RDB$FIELD_SUB_TYPE = 1, 'NUMERIC', IIF(f.RDB$FIELD_SUB_TYPE = 2, 'DECIMAL', 'BIGINT')) WHEN 23 THEN 'BOOLEAN' WHEN 24 THEN 'DECFLOAT(16)' WHEN 25 THEN 'DECFLOAT(34)' WHEN 26 THEN 'INT128' WHEN 27 THEN 'DOUBLE PRECISION' WHEN 28 THEN 'TIME WITH TIME ZONE' WHEN 29 THEN 'TIMESTAMP WITH TIME ZONE' WHEN 35 THEN 'TIMESTAMP' WHEN 37 THEN 'VARCHAR' WHEN 261 THEN 'BLOB' ELSE 'TYPE_' || CAST(f.RDB$FIELD_TYPE AS VARCHAR(10)) END AS DATA_TYPE, COALESCE(f.RDB$CHARACTER_LENGTH, f.RDB$FIELD_LENGTH, 0) AS LENGTH, COALESCE(f.RDB$FIELD_PRECISION, 0) AS PRECISION, ABS(COALESCE(f.RDB$FIELD_SCALE, 0)) AS SCALE, COALESCE(f.RDB$FIELD_SUB_TYPE, 0) AS SUB_TYPE, IIF(rf.RDB$NULL_FLAG = 1, 1, 0) AS NOT_NULL, TRIM(COALESCE(rf.RDB$DEFAULT_SOURCE, f.RDB$DEFAULT_SOURCE)) AS DEFAULT_SOURCE FROM RDB$RELATION_FIELDS rf JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE WHERE EXISTS (SELECT 1 FROM RDB$RELATIONS r WHERE r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME AND r.RDB$SYSTEM_FLAG = 0 AND r.RDB$VIEW_BLR IS NULL) ORDER BY 1, rf.RDB$FIELD_POSITION;
```

2) Execute em uma linha:

```powershell
& "C:\Program Files\Firebird\Firebird_4_0\isql.exe" -ch UTF8 -user SYSDBA -password 302b3c "192.168.1.100/3050:santarita" -i ".\schema_columns_normalized.sql" -o ".\schema_columns_normalized.txt"
```

Esse arquivo normalizado normalmente bate melhor com a visualizacao de colunas no DBeaver.
