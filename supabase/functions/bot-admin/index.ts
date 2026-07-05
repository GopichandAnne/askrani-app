// bot-admin — internal admin/debug function (Bot Phase 3a).
//
// Not public: gated by the ADMIN_TASK_SECRET function secret (x-admin-secret
// header), and verify_jwt stays at its default (true) so the gateway also
// requires a valid project JWT (invoke with the service-role key). Actions:
//
//   reindex_products {store_slug, mode?: "stale"|"all", max_rows?}
//       Incremental embed of the catalog. mode "all" re-stales everything first
//       (full rebuild). Drains up to max_rows stale rows per call and returns
//       {embedded, remaining} — a driver loops until remaining=0. This is the
//       SAME path a single product edit takes (one stale row -> one quick call),
//       and the path a 20K bulk import takes (insert rows stale -> loop drain).
//
//   search {store_slug, query}      -> hybrid search_products results (verify)
//   chat   {store_slug, message, session_id?} -> full turn reply + tools (verify)

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug } from "../_shared/config.ts";
import { embedDocuments, embedQuery, toVectorLiteral } from "../_shared/embeddings.ts";
import { productEmbedText } from "../_shared/tools.ts";
import {
  ingestDocument,
  reindexKnowledge,
  syncSavedQaToIndex,
} from "../_shared/knowledge.ts";
import { addToCart } from "../_shared/cart.ts";
import { placeOrder } from "../_shared/order.ts";
import { classifyTurn } from "../_shared/analytics.ts";
import { generateTurnReply } from "../_shared/conversation.ts";

const REINDEX_DEFAULT_MAX = 200;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = Deno.env.get("ADMIN_TASK_SECRET");
  if (!secret || req.headers.get("x-admin-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const db = serviceClient();
  const action = String(body.action ?? "");
  const storeSlug = String(body.store_slug ?? "");
  const store = storeSlug ? await getStoreBySlug(db, storeSlug) : null;
  if (!store) return json({ error: `unknown store: ${storeSlug}` }, 404);

  try {
    switch (action) {
      case "reindex_products": {
        const mode = String(body.mode ?? "stale");
        const maxRows = Number(body.max_rows ?? REINDEX_DEFAULT_MAX);
        if (mode === "all") {
          await db.from("products").update({ embedding_stale: true }).eq("store_id", store.id);
        }
        const result = await drainReindex(db, store.id, maxRows);
        return json({ store: store.slug, mode, ...result });
      }
      case "search": {
        const query = String(body.query ?? "");
        const embedding = await embedQuery(query);
        const { data, error } = await db.rpc("search_products", {
          p_store_id: store.id,
          p_query: query,
          p_query_embedding: toVectorLiteral(embedding),
          p_limit: Number(body.limit ?? 5),
        });
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, query, results: data });
      }
      case "ingest_document": {
        const title = String(body.title ?? "").trim();
        const text = String(body.text ?? "");
        if (!title || !text.trim()) return json({ error: "title and text required" }, 400);
        const { chunks } = await ingestDocument(db, store.id, title, text);
        const reindex = await reindexKnowledge(db, store.id, Number(body.max_rows ?? 200));
        return json({ store: store.slug, title, chunks, ...reindex });
      }
      case "sync_saved_qa": {
        const { synced } = await syncSavedQaToIndex(db, store.id);
        const reindex = await reindexKnowledge(db, store.id, Number(body.max_rows ?? 200));
        return json({ store: store.slug, synced, ...reindex });
      }
      case "reindex_knowledge": {
        const result = await reindexKnowledge(db, store.id, Number(body.max_rows ?? 200));
        return json({ store: store.slug, ...result });
      }
      case "delete_document": {
        const title = String(body.title ?? "").trim();
        if (!title) return json({ error: "title required" }, 400);
        const { error } = await db
          .from("knowledge_index")
          .delete()
          .eq("store_id", store.id)
          .eq("kind", "document_chunk")
          .eq("source_ref", title);
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, deleted: title });
      }
      case "search_knowledge": {
        const embedding = await embedQuery(String(body.query ?? ""));
        const { data, error } = await db.rpc("search_knowledge", {
          p_store_id: store.id,
          p_query_embedding: toVectorLiteral(embedding),
          p_limit: Number(body.limit ?? 4),
        });
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, query: body.query, results: data });
      }
      case "cart_add": {
        const res = await addToCart(
          db, store, String(body.session_id ?? ""), String(body.sku ?? ""), Number(body.quantity ?? 1),
        );
        return json({ store: store.slug, status: res.status, lines: res.lines });
      }
      case "place_order": {
        const res = await placeOrder(
          db, store, String(body.session_id ?? ""),
          body.fulfillment === "delivery" ? "delivery" : "pickup",
          String(body.confirmation_text ?? "yes"),
        );
        return json({ store: store.slug, ...res });
      }
      case "classify": {
        const analytics = await classifyTurn(String(body.message ?? ""), String(body.reply ?? ""));
        return json({ store: store.slug, analytics });
      }
      case "chat": {
        const message = String(body.message ?? "");
        const sessionId = String(body.session_id ?? "admin_debug");
        const { text, toolsUsed } = await generateTurnReply(db, store, {
          sessionId,
          inboundText: message,
        });
        return json({ store: store.slug, message, reply: text, toolsUsed });
      }
      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("[bot-admin] error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function drainReindex(db: any, storeId: string, maxRows: number) {
  const { data: stale, error } = await db
    .from("products")
    .select("id, name, brand, category, size, unit")
    .eq("store_id", storeId)
    .eq("embedding_stale", true)
    .limit(maxRows);
  if (error) throw new Error(error.message);
  if (!stale || stale.length === 0) return { embedded: 0, remaining: 0 };

  const vectors = await embedDocuments(stale.map(productEmbedText));
  const now = new Date().toISOString();
  for (let i = 0; i < stale.length; i++) {
    const { error: upErr } = await db
      .from("products")
      .update({
        embedding: toVectorLiteral(vectors[i]),
        embedding_stale: false,
        embedded_at: now,
      })
      .eq("id", stale[i].id);
    if (upErr) console.error(`[bot-admin] embed update ${stale[i].id}: ${upErr.message}`);
  }

  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("embedding_stale", true);
  return { embedded: stale.length, remaining: count ?? 0 };
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
