// gemini-embedding-001 client — Bot Phase 3a.
//
// Two entry points, asymmetric task types (measurably better retrieval):
//   embedQuery(text)       -> RETRIEVAL_QUERY   (one vector, live, per search)
//   embedDocuments(texts)  -> RETRIEVAL_DOCUMENT (batched, at index time)
//
// 20K-ready indexing: embedDocuments batches via :batchEmbedContents (default
// 100/call), paces between batches, and retries 429/5xx with exponential
// backoff. Vectors are MRL-truncated to 768 dims and L2-normalized (Google's
// guidance when using <3072 dims; also lets cosine/dot behave consistently).

const MODEL = "gemini-embedding-001";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const EMBED_DIM = 768;

const BATCH_SIZE = intEnv("EMBED_BATCH_SIZE", 100);
const MAX_RETRIES = intEnv("EMBED_MAX_RETRIES", 5);
const BASE_DELAY_MS = intEnv("EMBED_BASE_DELAY_MS", 500); // backoff base + inter-batch pace

function intEnv(name: string, dflt: number): number {
  const v = parseInt(Deno.env.get(name) ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

function apiKey(): string {
  const k = Deno.env.get("GEMINI_API_KEY");
  if (!k) throw new Error("GEMINI_API_KEY not set");
  return k;
}

/** L2-normalize (safe on zero vectors). Exposed for unit testing. */
export function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** pgvector text literal: [0.1,0.2,...]. Exposed for unit testing. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Embed one query string. Returns a normalized 768-dim vector. */
export async function embedQuery(text: string): Promise<number[]> {
  const res = await withRetry(() =>
    fetch(`${API_BASE}/models/${MODEL}:embedContent?key=${apiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBED_DIM,
      }),
    })
  );
  const json = await res.json();
  const values: number[] = json?.embedding?.values ?? [];
  return l2normalize(values);
}

/**
 * Embed many documents. Batches (BATCH_SIZE), paces, retries. Returns one
 * normalized vector per input, in order. Built for the 20K bulk/incremental
 * reindex path — call it with the stale rows' text.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await withRetry(() =>
      fetch(`${API_BASE}/models/${MODEL}:batchEmbedContents?key=${apiKey()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${MODEL}`,
            content: { parts: [{ text }] },
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: EMBED_DIM,
          })),
        }),
      })
    );
    const json = await res.json();
    const embeddings: { values: number[] }[] = json?.embeddings ?? [];
    for (const e of embeddings) out.push(l2normalize(e.values ?? []));
    if (i + BATCH_SIZE < texts.length) await sleep(BASE_DELAY_MS); // pace
  }
  return out;
}

/** Fetch with exponential backoff on 429/5xx. Throws on persistent failure. */
async function withRetry(fn: () => Promise<Response>): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fn();
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`embed ${res.status}: ${await res.text()}`);
      } else {
        throw new Error(`embed ${res.status}: ${await res.text()}`);
      }
    } catch (e) {
      lastErr = e;
    }
    if (attempt < MAX_RETRIES) {
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt)); // 0.5s,1s,2s,4s,8s
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("embed failed");
}
