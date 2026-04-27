/**
 * Lê a lista de tabelas a partir de RI/ri_db.json (recorte RI) e exporta, por tabela,
 * os últimos N registos (padrão 10) para RI/ri_data.json via Connection.execute.
 * Opcional: R_DATA_TABELAS=db para usar db.json na raiz (todas as tabelas do metadata).
 * Ordenação: PK (DESC); senão primeira coluna não-BLOB; senão FIRST N sem ORDER.
 * BLOBs: por omissão (R_DATA_BLOBS=files) gravam ficheiros em RI/ri_data_blobs/ e o JSON
 * contém {_arquivo,_bytes,_ext}; R_DATA_BLOBS=inline repõe o conteúdo no JSON.
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { OriusORM } from "./orm";
import { sanitizeIdentifier } from "./orm/sql-utils";

dotenv.config();

const N = Math.max(1, Math.min(500, Number(process.env.R_DATA_LIMITE || 10)));
/** Com R_DATA_TABELAS=db (ou all), usa db.json na raiz em vez de RI/ri_db.json. */
const usarDbCompleto =
  String(process.env.R_DATA_TABELAS || "").toLowerCase() === "db" ||
  String(process.env.R_DATA_TABELAS || "").toLowerCase() === "all";

/**
 * Alinhado ao character set padrão do legado (Firebird ISO8859_1 / WIN1252 single-byte no Node: "latin1").
 * UTF8: tenta UTF-8 e recua para Latin-1 em RTF. AUTO: UTF-8 se não houver U+FFFD, senão heurísticas antigas.
 */
function charsetExportBlob(): "ISO8859_1" | "UTF8" | "AUTO" {
  const c = String(process.env.R_DATA_CHARSET || "ISO8859_1")
    .replace(/[-\s]/g, "_")
    .toUpperCase();
  if (c === "UTF8" || c === "UTF_8") return "UTF8";
  if (c === "AUTO" || c === "MIXED") return "AUTO";
  return "ISO8859_1";
}

/** ficheiros | 1 | true (omissão) → extrair BLOBs para pasta; inline | 0 | false → JSON grande */
function blobExportMode(): "files" | "inline" {
  const v = String(process.env.R_DATA_BLOBS ?? "files").toLowerCase();
  if (v === "inline" || v === "0" || v === "false" || v === "no" || v === "off") {
    return "inline";
  }
  return "files";
}

function apagarBlobsAnterioresSePedido(
  projectRoot: string,
  relDir: string
): void {
  const n = String(process.env.R_DATA_BLOBS_CLEAN ?? "1").toLowerCase();
  if (n === "0" || n === "false" || n === "no" || n === "off") return;
  const abs = path.join(projectRoot, relDir);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { recursive: true, force: true });
  }
}

const BLOBS_DIR_REL = "RI/ri_data_blobs" as const;

type BlobCtx = {
  projectRoot: string;
  tabela: string;
  indice: number;
  colPath: string;
  blobSubDir: string;
};

type ColDef = {
  nome: string;
  tipo: string;
  primary_key?: boolean;
};

type TableDef = {
  tabela?: string;
  colunas?: ColDef[];
};

function isOrderableType(t: string | undefined): boolean {
  if (!t) return false;
  const u = t.toUpperCase();
  if (u === "BLOB" || u.includes("BLOB") || u === "ARRAY") return false;
  return true;
}

/** Colunas a usar no ORDER BY ... DESC (PKs em ordem de definição, só tipos orderable). */
function colunasOrdenacao(colunas: ColDef[]): string[] {
  const pks = colunas.filter(
    (c) => c.primary_key === true && isOrderableType(c.tipo) && c.nome
  );
  if (pks.length) {
    return pks.map((c) => c.nome);
  }
  const c = colunas.find((x) => isOrderableType(x.tipo) && x.nome);
  return c ? [c.nome] : [];
}

function sqlUltimosN(nomeTabela: string, orderCols: string[], limite: number): string {
  const t = sanitizeIdentifier(nomeTabela, "tabela");
  if (orderCols.length) {
    const by = orderCols
      .map((c) => `${sanitizeIdentifier(c, "coluna")} DESC`)
      .join(", ");
    return `SELECT * FROM ${t} ORDER BY ${by} ROWS ${limite}`;
  }
  return `SELECT FIRST ${limite} * FROM ${t}`;
}

type JsonVal = null | string | number | boolean | JsonVal[] | { [k: string]: JsonVal };

function isGzipBuffer(b: Buffer): boolean {
  return b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
}

/** Cabeçalho ZLIB (RFC 1950): 0x78; (CMF*256+FLG) % 31 === 0 (evita “x” sozinho). */
function pareceCabeçalhoZlib(b: Buffer): boolean {
  if (b.length < 2 || b[0] !== 0x78) return false;
  const w = 256 * b[0]! + b[1]!;
  return w % 31 === 0;
}

/** Legado: RTF puro, zlib/gzip(→RTF), ou bytes/BOM/ruído antes de `{\rtf` no início. */
function pareceRtf(b: Buffer): boolean {
  if (b.length < 5) return false;
  const n = Math.min(b.length, 65536);
  const s = b.toString("latin1", 0, n);
  if (s.indexOf("{\\rtf") >= 0) return true;
  return false;
}

function pareceXml(b: Buffer): boolean {
  let o = 0;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) o = 3;
  if (b.length - o < 1) return false;
  const head = b
    .toString("utf8", o, Math.min(b.length, o + 200))
    .trimStart();
  return head.startsWith("<?xml") || head.startsWith("<");
}

function ratioNulos(b: Buffer): number {
  if (b.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0) n++;
  }
  return n / b.length;
}

function safeFileSegment(s: string, max = 80): string {
  const t = s.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (t || "blob").slice(0, max);
}

/**
 * RTF muitas vezes vem com ZLIB (0x78 0x9C, p.ex. WPTools), não GZIP. XML em colunas
 * tipo ARQUIVO_* passa a .xml. `{\rtf` pode aparecer após procurar nos primeiros 64 kiB.
 */
function decidirConteudoArquivo(v: Buffer): { body: Buffer; ext: string } {
  if (v.length === 0) return { body: v, ext: "bin" };
  if (isGzipBuffer(v)) {
    try {
      const d = zlib.gunzipSync(v);
      if (pareceRtf(d)) {
        return { body: d, ext: "rtf" };
      }
      if (pareceXml(d)) {
        return { body: d, ext: "xml" };
      }
    } catch {
      /* manter original */
    }
    return { body: v, ext: "gz" };
  }
  if (pareceCabeçalhoZlib(v)) {
    try {
      const d = zlib.inflateSync(v);
      if (pareceRtf(d)) {
        return { body: d, ext: "rtf" };
      }
      if (pareceXml(d)) {
        return { body: d, ext: "xml" };
      }
      if (d.length < 2_000_000 && ratioNulos(d) < 0.02) {
        return { body: d, ext: "txt" };
      }
    } catch {
      /* não é zlib de confiança */
    }
  }
  if (pareceRtf(v)) {
    return { body: v, ext: "rtf" };
  }
  if (pareceXml(v)) {
    return { body: v, ext: "xml" };
  }
  if (v.length < 2_000_000 && ratioNulos(v) < 0.02) {
    return { body: v, ext: "txt" };
  }
  return { body: v, ext: "bin" };
}

function escreverBlobEreferencia(v: Buffer, ctx: BlobCtx): JsonVal {
  if (v.length === 0) {
    return null;
  }
  const { body, ext } = decidirConteudoArquivo(v);
  const t = safeFileSegment(ctx.tabela);
  const c = safeFileSegment(ctx.colPath.replace(/[[\].]/g, "_"));
  const name = `${ctx.indice}_${c}.${ext}`;
  const relDir = path.join(ctx.blobSubDir, t);
  const absDir = path.join(ctx.projectRoot, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const rel = path.join(relDir, name).replace(/\\/g, "/");
  const full = path.join(ctx.projectRoot, rel);
  fs.writeFileSync(full, body);
  return {
    _arquivo: rel,
    _bytes: body.length,
    _ext: ext,
  };
}

/** GZIP ou ZLIB (WPTools); sem compressão, mantém o buffer. */
function descomprimirSePossivel(v: Buffer): Buffer {
  if (isGzipBuffer(v)) {
    try {
      return zlib.gunzipSync(v);
    } catch {
      return v;
    }
  }
  if (pareceCabeçalhoZlib(v)) {
    try {
      return zlib.inflateSync(v);
    } catch {
      return v;
    }
  }
  return v;
}

/** Muitos BLOBs (ex.: R_TEMPLATE) guardam RTF: gzip, zlib, ou a plain; JSON não pode ter binário cru. */
function bufferParaTextoJson(v: Buffer): JsonVal {
  const raw = descomprimirSePossivel(v);
  if (raw.length < 2_000_000) {
    const cs = charsetExportBlob();
    const l1 = raw.toString("latin1");
    const rtfLatin = pareceRtf(raw);
    if (cs === "ISO8859_1") {
      if (rtfLatin || ratioNulos(raw) < 0.02) {
        return l1;
      }
    } else if (cs === "UTF8") {
      const u8 = raw.toString("utf8");
      if (u8.length > 0 && !u8.includes("\uFFFD")) {
        return u8;
      }
      if (rtfLatin) {
        return l1;
      }
      if (u8.length > 0) {
        return u8;
      }
    } else {
      // AUTO: UTF-8 se limpo, senão Latin-1 para RTF, senão UTF-8
      const u8 = raw.toString("utf8");
      if (u8.length > 0 && !u8.includes("\uFFFD")) {
        return u8;
      }
      if (rtfLatin) {
        return l1;
      }
      if (u8.length > 0) {
        return u8;
      }
    }
  }
  if (v.length <= 1024) {
    return { _binary_b64: v.toString("base64") };
  }
  return {
    _binary: true,
    _bytes: v.length,
    _b64_inicio: v.subarray(0, 32).toString("base64"),
  };
}

function valorParaJson(v: unknown, bctx?: BlobCtx): JsonVal {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) {
    if (bctx) {
      return escreverBlobEreferencia(v, bctx);
    }
    return bufferParaTextoJson(v);
  }
  if (typeof v === "function") {
    return {
      _erro:
        "Valor ainda é função (BLOB lazy). Use { materializeBlobs: true } em Connection.execute.",
    };
  }
  if (Array.isArray(v)) {
    if (bctx) {
      return (v as unknown[]).map((item, i) =>
        valorParaJson(item, {
          ...bctx,
          colPath: `${bctx.colPath}[${i}]`,
        })
      ) as JsonVal;
    }
    return (v as unknown[]).map((item) => valorParaJson(item)) as JsonVal;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: { [k: string]: JsonVal } = {};
    for (const k of Object.keys(o)) {
      out[k] = valorParaJson(
        o[k],
        bctx
          ? {
              ...bctx,
              colPath: bctx.colPath ? `${bctx.colPath}.${k}` : k,
            }
          : undefined
      );
    }
    return out;
  }
  return { _tipo: typeof v, _dica: "tipo não mapeado para JSON" };
}

function linhaParaRegisto(
  row: Record<string, unknown>,
  blob: Omit<BlobCtx, "colPath"> | undefined
): { [k: string]: JsonVal } {
  const o: { [k: string]: JsonVal } = {};
  for (const k of Object.keys(row)) {
    o[k] = valorParaJson(
      row[k],
      blob ? { ...blob, colPath: k } : undefined
    );
  }
  return o;
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const metaPath = usarDbCompleto
    ? path.join(projectRoot, "db.json")
    : path.join(projectRoot, "RI", "ri_db.json");
  if (!fs.existsSync(metaPath)) {
    throw new Error(
      `Ficheiro não encontrado: ${metaPath} (omissão: RI/ri_db.json; R_DATA_TABELAS=db → db.json na raiz).`
    );
  }

  const all = JSON.parse(
    fs.readFileSync(metaPath, "utf8")
  ) as Record<string, TableDef>;
  const tabelas = Object.keys(all).sort((a, b) => a.localeCompare(b, "en"));

  const modoBlob = blobExportMode();
  if (modoBlob === "files") {
    apagarBlobsAnterioresSePedido(projectRoot, BLOBS_DIR_REL);
  }

  const orm = OriusORM.fromEnv(process.env);
  await orm.authenticate();
  const conn = orm.getConnection();

  const saida: Record<string, unknown> = {
    _meta: {
      gerado: new Date().toISOString(),
      fonte: path.relative(projectRoot, metaPath).replace(/\\/g, "/"),
      tabelas: tabelas.length,
      ultimosN: N,
      blobs: modoBlob,
      ...(modoBlob === "files" ? { pastaBlobs: BLOBS_DIR_REL } : {}),
    },
  };

  let i = 0;
  for (const name of tabelas) {
    i += 1;
    if (i % 50 === 0) {
      process.stderr.write(`… ${i}/${tabelas.length} tabelas\n`);
    }

    const def = all[name] || {};
    const colunas = Array.isArray(def.colunas) ? def.colunas : [];
    const orderCols = colunasOrdenacao(colunas);

    let tabelaSeg: string;
    try {
      tabelaSeg = sanitizeIdentifier(
        (def as TableDef).tabela || name,
        "tabela"
      );
    } catch (e) {
      saida[name] = {
        order_by: orderCols,
        ultimos: [],
        erro: e instanceof Error ? e.message : String(e),
      };
      continue;
    }

    const sql = sqlUltimosN(tabelaSeg, orderCols, N);
    try {
      const rows = (await conn.execute<Record<string, unknown>>(sql, [], undefined, {
        materializeBlobs: true,
      })) as Record<string, unknown>[];
      const baseBlob: Omit<BlobCtx, "colPath" | "indice"> = {
        projectRoot,
        tabela: tabelaSeg,
        blobSubDir: BLOBS_DIR_REL,
      };
      const registos = (rows || []).map((r, indice) =>
        linhaParaRegisto(
          r,
          modoBlob === "files"
            ? { ...baseBlob, indice }
            : undefined
        )
      );
      saida[tabelaSeg] = {
        order_by: orderCols.length
          ? orderCols.map((c) => c + " DESC")
          : ["(sem ORDER — SELECT FIRST)"],
        sql,
        ultimos: registos,
      };
    } catch (e) {
      saida[tabelaSeg] = {
        order_by: orderCols,
        sql,
        ultimos: [],
        erro: e instanceof Error ? e.message : String(e),
      };
    }
  }

  orm.close();

  const outPath = path.join(projectRoot, "RI", "ri_data.json");
  fs.writeFileSync(outPath, JSON.stringify(saida, null, 2), "utf8");
  const meta = saida._meta as { fonte: string };
  const tail =
    modoBlob === "files"
      ? `, BLOBs em ${BLOBS_DIR_REL}`
      : "";
  process.stderr.write(
    `OK: ${outPath} (${tabelas.length} tabelas, ${N} registo(s) max por tabela, fonte ${meta.fonte}${tail})\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
