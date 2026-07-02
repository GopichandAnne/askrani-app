// Knowledge base ingestion + RAG indexing — Bot Phase 3b.
//
// Rebuild of KnowledgeBase.gs: documents are chunked, saved_qa rows are indexed
// as single units, both into knowledge_index and embedded (gemini-embedding-001,
// RETRIEVAL_DOCUMENT). Reindex is incremental via embedding_stale, same drain
// pattern as products — so it's the same 20K-ready path.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { embedDocuments, toVectorLiteral } from "./embeddings.ts";

const CHUNK_CHARS = 3000; // ~750 tokens
const OVERLAP_CHARS = 400; // ~100 tokens

/** Rough token estimate (~4 chars/token). Exposed for tests. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into overlapping, boundary-aware chunks. Prefers paragraph then
 * sentence breaks (incl. the Devanagari danda) in the back half of the window;
 * always terminates and always overlaps. Pure — unit-tested.
 */
export function chunkText(
  text: string,
  chunkChars = CHUNK_CHARS,
  overlapChars = OVERLAP_CHARS,
): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= chunkChars) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkChars, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const half = chunkChars * 0.5;
      const para = window.lastIndexOf("\n\n");
      const sent = Math.max(window.lastIndexOf(". "), window.lastIndexOf("।"));
      const bp = para > half ? para : (sent > half ? sent + 1 : -1);
      if (bp > 0) end = start + bp;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}

/** Ingest one document: replace its existing chunks, insert new ones (stale). */
export async function ingestDocument(
  db: SupabaseClient,
  storeId: string,
  title: string,
  text: string,
): Promise<{ chunks: number }> {
  await db
    .from("knowledge_index")
    .delete()
    .eq("store_id", storeId)
    .eq("kind", "document_chunk")
    .eq("source_ref", title);

  const chunks = chunkText(text);
  if (chunks.length === 0) return { chunks: 0 };

  const rows = chunks.map((c, i) => ({
    store_id: storeId,
    kind: "document_chunk",
    source_ref: title,
    chunk_index: i,
    chunk_text: c,
    token_count: estimateTokens(c),
    embedding_stale: true,
  }));
  const { error } = await db.from("knowledge_index").insert(rows);
  if (error) throw new Error(error.message);
  return { chunks: chunks.length };
}

/** Mirror active saved_qa into the index (clear + reinsert; small list). */
export async function syncSavedQaToIndex(
  db: SupabaseClient,
  storeId: string,
): Promise<{ synced: number }> {
  const { data: qas } = await db
    .from("saved_qa")
    .select("id, question, answer, active")
    .eq("store_id", storeId)
    .eq("active", true);

  await db
    .from("knowledge_index")
    .delete()
    .eq("store_id", storeId)
    .eq("kind", "saved_qa");

  const active = qas ?? [];
  if (active.length === 0) return { synced: 0 };

  const rows = active.map(
    (q: { id: string; question: string; answer: string | null }) => ({
      store_id: storeId,
      kind: "saved_qa",
      source_ref: q.id,
      chunk_index: 0,
      chunk_text: `Q: ${q.question}\nA: ${q.answer ?? ""}`,
      token_count: estimateTokens(q.question + (q.answer ?? "")),
      embedding_stale: true,
    }),
  );
  const { error } = await db.from("knowledge_index").insert(rows);
  if (error) throw new Error(error.message);
  return { synced: rows.length };
}

/** Drain stale knowledge rows: embed + write. Bounded per call (20K-ready). */
export async function reindexKnowledge(
  db: SupabaseClient,
  storeId: string,
  maxRows = 200,
): Promise<{ embedded: number; remaining: number }> {
  const { data: stale, error } = await db
    .from("knowledge_index")
    .select("id, chunk_text")
    .eq("store_id", storeId)
    .eq("embedding_stale", true)
    .limit(maxRows);
  if (error) throw new Error(error.message);
  if (!stale || stale.length === 0) return { embedded: 0, remaining: 0 };

  const vectors = await embedDocuments(
    stale.map((r: { chunk_text: string }) => r.chunk_text),
  );
  const now = new Date().toISOString();
  for (let i = 0; i < stale.length; i++) {
    const { error: upErr } = await db
      .from("knowledge_index")
      .update({
        embedding: toVectorLiteral(vectors[i]),
        embedding_stale: false,
        embedded_at: now,
      })
      .eq("id", stale[i].id);
    if (upErr) console.error(`[knowledge] embed update ${stale[i].id}: ${upErr.message}`);
  }

  const { count } = await db
    .from("knowledge_index")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("embedding_stale", true);
  return { embedded: stale.length, remaining: count ?? 0 };
}
