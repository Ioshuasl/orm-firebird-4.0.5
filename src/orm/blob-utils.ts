/**
 * Percorre o resultado de `db.query` e substitui funções (BLOB lazy) por Buffer / string.
 * Deve ser chamado **antes** de `db.detach()` — o id do BLOB fica inválido depois.
 */
export async function materializeBlobsInRows(rows: unknown): Promise<void> {
  if (!rows || !Array.isArray(rows)) {
    return;
  }
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const r = row as Record<string, unknown>;
    for (const k of Object.keys(r)) {
      if (typeof r[k] === "function") {
        try {
          r[k] = await materializeNodeFirebirdBlob(r[k]);
        } catch {
          r[k] = null;
        }
      }
    }
  }
}

/**
 * O driver node-firebird devolve colunas BLOB como função (lazy read) em vez de Buffer.
 * Se fizer `String(essaFunção)` obtém-se o source da função, não o conteúdo.
 * Isto materializa o BLOB lendo o stream (API típica: fn((err, name, stream) => ...)).
 */
export async function materializeNodeFirebirdBlob(
  v: unknown
): Promise<Buffer | string | null> {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint")
    return null;

  if (typeof v !== "function") {
    return null;
  }

  return new Promise<Buffer | string | null>((resolve, reject) => {
    try {
      (v as (cb: (err: Error | null, nameField?: string, stream?: any) => void) => void)(
        (err: Error | null, _nameField?: string, stream?: any) => {
          if (err) {
            reject(err);
            return;
          }
          if (stream == null) {
            resolve(null);
            return;
          }
          if (Buffer.isBuffer(stream)) {
            resolve(stream);
            return;
          }
          if (typeof stream === "string") {
            resolve(stream);
            return;
          }
          if (stream && typeof stream.on === "function") {
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => {
              chunks.push(
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any)
              );
            });
            stream.on("end", () => {
              try {
                resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0));
              } catch (e) {
                reject(e);
              }
            });
            stream.on("error", (e: Error) => reject(e));
            return;
          }
          resolve(null);
        }
      );
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
