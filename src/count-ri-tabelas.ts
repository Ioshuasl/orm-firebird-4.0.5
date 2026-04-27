/**
 * Lê RI/ri_db.json, executa SELECT COUNT(*) por tabela via Connection.execute
 * e grava RI/ri_db-contagem.md + RI/count-ri-tabelas.sql
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { OriusORM } from "./orm";
import { sanitizeIdentifier } from "./orm/sql-utils";

dotenv.config();

type Row = Record<string, unknown>;

function pickCount(row: Row | undefined): number {
  if (!row) return 0;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Math.trunc(Number(v));
    }
    if (typeof v === "bigint") return Number(v);
  }
  return 0;
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const riJson = path.join(projectRoot, "RI", "ri_db.json");
  if (!fs.existsSync(riJson)) {
    throw new Error(`Arquivo não encontrado: ${riJson} (gerar com npm run gen:ri-db).`);
  }

  const meta = JSON.parse(fs.readFileSync(riJson, "utf8")) as Record<string, unknown>;
  const rawNames = Object.keys(meta).sort((a, b) => a.localeCompare(b, "en"));

  const orm = OriusORM.fromEnv(process.env);
  await orm.authenticate();
  const conn = orm.getConnection();

  const results: { tabela: string; qtd: number | null; erro?: string }[] = [];
  for (const raw of rawNames) {
    let tabela: string;
    try {
      tabela = sanitizeIdentifier(raw, "tabela");
    } catch (e) {
      results.push({
        tabela: raw,
        qtd: null,
        erro: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    try {
      const sql = `SELECT COUNT(*) AS QTD FROM ${tabela}`;
      const rows = await conn.execute<Row>(sql, []);
      const qtd = pickCount(rows[0]);
      results.push({ tabela, qtd });
    } catch (e) {
      results.push({
        tabela,
        qtd: null,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }

  orm.close();

  const when = new Date().toISOString();
  const sqlLines = [
    "-- Gerado a partir de RI/ri_db.json: uma instrução por tabela (Firebird).",
    `-- Atualizado em: ${when}`,
    "-- Cada query retorna o nome da tabela (literal) e COUNT(*).",
    "",
    ...rawNames.map((raw) => {
      let t: string;
      try {
        t = sanitizeIdentifier(raw, "tabela");
      } catch {
        return `-- SKIP identificador inválido: ${raw}`;
      }
      return `SELECT '${t}' AS TABELA, COUNT(*) AS QTD FROM ${t};`;
    }),
  ];
  const sqlPath = path.join(projectRoot, "RI", "count-ri-tabelas.sql");
  fs.writeFileSync(sqlPath, sqlLines.join("\n") + "\n", "utf8");

  const comErro = results.filter((r) => r.erro != null);
  const semErro = results.filter((r) => r.erro == null && r.qtd != null);
  const comRegistros = semErro.filter((r) => (r.qtd as number) > 0);
  const vazias = semErro.filter((r) => (r.qtd as number) === 0);

  const listar = (items: { tabela: string }[]) =>
    items.length
      ? items.map((i) => `- \`${i.tabela}\``).join("\n")
      : "- *(nenhuma)*";

  const resumo = [
    "## Resumo",
    "",
    "| Situação | Quantidade |",
    "|----------|------------:|",
    `| Tabelas **com** registos (≥ 1) | **${comRegistros.length}** |`,
    `| Tabelas **vazias** (0 registos) | **${vazias.length}** |`,
    `| Tabelas com **erro** na contagem | **${comErro.length}** |`,
    `| **Total** no \`ri_db.json\` | **${results.length}** |`,
    "",
    "### Tabelas com registos",
    "",
    listar(
      [...comRegistros].sort((a, b) => a.tabela.localeCompare(b.tabela, "en"))
    ),
    "",
    "### Tabelas vazias (0 registos)",
    "",
    listar([...vazias].sort((a, b) => a.tabela.localeCompare(b.tabela, "en"))),
    "",
  ];
  if (comErro.length) {
    resumo.push(
      "### Tabelas com erro na contagem",
      "",
      listar(
        [...comErro].sort((a, b) => a.tabela.localeCompare(b.tabela, "en"))
      ),
      ""
    );
  }
  resumo.push("---", "");

  const tableMd = results.map((r) => {
    if (r.erro) {
      return `| \`${r.tabela}\` | — | \`${String(r.erro).replace(/`/g, "'")}\` |`;
    }
    return `| \`${r.tabela}\` | ${r.qtd} |  |`;
  });

  const md = [
    "# Contagem de registros (RI)",
    "",
    `Gerado em: **${when}** por \`src/count-ri-tabelas.ts\` (\`Connection.execute\`).`,
    "",
    "Fonte da lista de tabelas: `RI/ri_db.json`.",
    "",
    ...resumo,
    "## Detalhe por tabela",
    "",
    "| Tabela | Registros | Notas |",
    "|--------|----------:|:------|",
    ...tableMd,
    "",
  ];

  if (comErro.length) {
    md.push(
      `**Atenção:** ${comErro.length} tabela(s) com erro (permissão, tabela inexistente no banco, etc.). Ver coluna *Notas* abaixo.`,
      ""
    );
  }
  md.push("---", "", "*SQL equivalente: ver `RI/count-ri-tabelas.sql`.*", "");

  const outMd = path.join(projectRoot, "RI", "ri_db-contagem.md");
  fs.writeFileSync(outMd, md.join("\n"), "utf8");

  console.log(
    `OK: ${outMd} e ${sqlPath} (${results.length} tabelas: ${comRegistros.length} com registos, ${vazias.length} vazias, ${comErro.length} com erro).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
