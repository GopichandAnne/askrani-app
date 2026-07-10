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
import { extractFileText } from "../_shared/extract.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { addToCart } from "../_shared/cart.ts";
import { placeOrder } from "../_shared/order.ts";
import { classifyTurn } from "../_shared/analytics.ts";
import { findResponder, relayStaffAnswer } from "../_shared/responders.ts";
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
        const vf = body.valid_from ? String(body.valid_from) : null;
        const vu = body.valid_until ? String(body.valid_until) : null;
        const { chunks } = await ingestDocument(db, store.id, title, text, null, null, vf, vu);
        const reindex = await reindexKnowledge(db, store.id, Number(body.max_rows ?? 200));
        return json({ store: store.slug, title, chunks, ...reindex });
      }
      case "list_integrations": {
        const { data } = await db
          .from("store_integrations")
          .select("id, name, description, params_schema, kind, endpoint_url, side_effect, enabled, timeout_ms, auth_secret, updated_at")
          .eq("store_id", store.id)
          .order("name");
        // Never return the raw secret to the panel — just whether one is set.
        // deno-lint-ignore no-explicit-any
        const integrations = (data ?? []).map((r: any) => {
          const { auth_secret, ...rest } = r;
          return { ...rest, has_secret: !!auth_secret };
        });
        return json({ store: store.slug, integrations });
      }
      case "set_integration": {
        // Register/update a per-store connector (a tool the bot can call).
        const name = String(body.name ?? "").trim();
        const endpoint = String(body.endpoint_url ?? "").trim();
        if (!name || !endpoint) return json({ error: "name and endpoint_url required" }, 400);
        // deno-lint-ignore no-explicit-any
        const row: Record<string, any> = {
          store_id: store.id,
          name,
          description: String(body.description ?? ""),
          params_schema: body.params_schema ?? { type: "object", properties: {}, required: [] },
          kind: String(body.kind ?? "http"),
          endpoint_url: endpoint,
          side_effect: !!body.side_effect,
          enabled: body.enabled === undefined ? true : !!body.enabled,
          timeout_ms: Number(body.timeout_ms ?? 4000),
          updated_at: new Date().toISOString(),
        };
        // Only touch the secret when a new one is provided — blank keeps the
        // existing one on edit (and the panel never sees it).
        if (body.auth_secret) row.auth_secret = String(body.auth_secret);
        const { error } = await db.from("store_integrations").upsert(row, { onConflict: "store_id,name" });
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, name, ok: true });
      }
      case "test_integration": {
        const name = String(body.name ?? "").trim();
        if (!name) return json({ error: "name required" }, 400);
        const { data: integ } = await db
          .from("store_integrations")
          .select("*")
          .eq("store_id", store.id)
          .eq("name", name)
          .maybeSingle();
        if (!integ) return json({ error: "integration not found" }, 404);
        const { executeIntegration } = await import("../_shared/integrations.ts");
        const result = await executeIntegration(
          integ, store, "web_paneltest", (body.args as Record<string, unknown>) ?? {},
        );
        return json({ store: store.slug, name, result });
      }
      case "delete_integration": {
        const name = String(body.name ?? "").trim();
        if (!name) return json({ error: "name required" }, 400);
        const { error } = await db
          .from("store_integrations")
          .delete()
          .eq("store_id", store.id)
          .eq("name", name);
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, name, deleted: true });
      }
      case "suggest_chips": {
        // Compose "starter question" tiles from the store's own context.
        const key = Deno.env.get("GEMINI_API_KEY");
        if (!key) return json({ error: "AI not configured" }, 500);
        const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";
        const { data: cfg } = await db
          .from("agent_config")
          .select("key, value")
          .eq("store_id", store.id)
          .in("key", ["store_prompt", "engage_info", "personality", "promotions"]);
        const m = new Map((cfg ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value ?? ""]));
        const { data: kb } = await db
          .from("knowledge_index")
          .select("chunk_text")
          .eq("store_id", store.id)
          .eq("kind", "document_chunk")
          .not("chunk_text", "is", null)
          .limit(3);
        const kbText = (kb ?? []).map((k: { chunk_text: string }) => k.chunk_text).join(" ").slice(0, 1400);
        const context =
          `Business: ${store.store_display_name ?? store.slug}` +
          (store.business_type ? ` (a ${store.business_type})` : "") + "\n" +
          (m.get("store_prompt") ? `About: ${m.get("store_prompt")}\n` : "") +
          (m.get("engage_info") ? `How it helps customers: ${m.get("engage_info")}\n` : "") +
          (kbText ? `From its knowledge base: ${kbText}\n` : "");
        const sys =
          "You set up chat assistants for local businesses. Given the business info, write FOUR short " +
          "'starter question' chips a customer would tap to begin a chat — the things people actually " +
          "ask THIS business. Each 3 to 6 words, natural spoken phrasing, end with '?' where it's a " +
          "question, specific to this business (use its real products/services/policies), no numbering, " +
          "no near-duplicates. Return JSON.";
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: sys }] },
              contents: [{ role: "user", parts: [{ text: context }] }],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 300,
                thinkingConfig: { thinkingBudget: 0 },
                responseMimeType: "application/json",
                responseSchema: {
                  type: "object",
                  properties: { chips: { type: "array", items: { type: "string" } } },
                  required: ["chips"],
                },
              },
            }),
          },
        );
        if (!res.ok) return json({ error: `AI error ${res.status}` }, 500);
        // deno-lint-ignore no-explicit-any
        const j: any = await res.json();
        const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
        let chips: string[] = [];
        try {
          chips = (JSON.parse(text).chips ?? []).map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 4);
        } catch { /* leave empty */ }
        return json({ store: store.slug, chips });
      }
      case "answer_ticket": {
        const ticketId = String(body.ticket_id ?? "").trim();
        const answer = String(body.answer ?? "").trim();
        const by = (String(body.by ?? "").trim()) || "Store team";
        if (!ticketId || !answer) return json({ error: "ticket_id and answer required" }, 400);
        const { answerTicket } = await import("../_shared/responders.ts");
        const res = await answerTicket(db, store, ticketId, answer, by);
        return json(res);
      }
      case "set_document_dates": {
        const title = String(body.title ?? "").trim();
        if (!title) return json({ error: "title required" }, 400);
        const vf = body.valid_from ? String(body.valid_from) : null;
        const vu = body.valid_until ? String(body.valid_until) : null;
        const { error, count } = await db
          .from("knowledge_index")
          .update({ valid_from: vf, valid_until: vu }, { count: "exact" })
          .eq("store_id", store.id)
          .eq("kind", "document_chunk")
          .eq("source_ref", title);
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, title, updated: count ?? 0, valid_from: vf, valid_until: vu });
      }
      case "ingest_file": {
        const title = String(body.title ?? "").trim();
        const path = String(body.storage_path ?? "");
        const mime = String(body.mime ?? "");
        if (!title || !path) return json({ error: "title and storage_path required" }, 400);
        const { data: blob, error: dlErr } = await db.storage.from("kb").download(path);
        if (dlErr || !blob) return json({ error: `download failed: ${dlErr?.message ?? "no file"}` }, 500);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = "";
        try {
          text = await extractFileText(bytes, mime, path);
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          console.error(`[bot-admin] extract failed for ${path}: ${detail}`);
          return json({ error: `could not read the file: ${detail}` }, 422);
        }
        if (!text.trim()) return json({ error: "no text could be extracted from the file" }, 422);
        const vf = body.valid_from ? String(body.valid_from) : null;
        const vu = body.valid_until ? String(body.valid_until) : null;
        const { chunks } = await ingestDocument(db, store.id, title, text, path, mime, vf, vu);
        const reindex = await reindexKnowledge(db, store.id, Number(body.max_rows ?? 500));
        return json({ store: store.slug, title, chunks, chars: text.length, ...reindex });
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
        const { data: paths } = await db
          .from("knowledge_index")
          .select("source_path")
          .eq("store_id", store.id)
          .eq("kind", "document_chunk")
          .eq("source_ref", title)
          .not("source_path", "is", null)
          .limit(1);
        const { error } = await db
          .from("knowledge_index")
          .delete()
          .eq("store_id", store.id)
          .eq("kind", "document_chunk")
          .eq("source_ref", title);
        if (error) return json({ error: error.message }, 500);
        const path = paths?.[0]?.source_path;
        if (path) await db.storage.from("kb").remove([path]); // remove the original
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
      case "staff_reply": {
        const phone = String(body.phone ?? "");
        const responder = await findResponder(db, store.slug, phone);
        if (!responder) return json({ error: "not a responder for this store" }, 400);
        const res = await relayStaffAnswer(
          db, store, store.whatsapp_phone_number_id ?? "", responder, String(body.text ?? ""),
        );
        return json({ store: store.slug, responder: responder.name ?? phone, ...res });
      }
      case "classify": {
        const analytics = await classifyTurn(String(body.message ?? ""), String(body.reply ?? ""));
        return json({ store: store.slug, analytics });
      }
      case "chat": {
        const message = String(body.message ?? "");
        const sessionId = String(body.session_id ?? "admin_debug");
        // Optional image for testing the customer-photo path: pull from Storage
        // (image_path) or accept inline base64 (image_b64).
        let image: { base64: string; mime: string } | undefined;
        if (body.image_path) {
          const { data: blob } = await db.storage.from("kb").download(String(body.image_path));
          if (blob) {
            image = {
              base64: encodeBase64(new Uint8Array(await blob.arrayBuffer())),
              mime: String(body.image_mime ?? "image/png"),
            };
          }
        } else if (body.image_b64) {
          image = { base64: String(body.image_b64), mime: String(body.image_mime ?? "image/png") };
        }
        const { text, toolsUsed } = await generateTurnReply(db, store, {
          sessionId,
          inboundText: message,
          image,
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
