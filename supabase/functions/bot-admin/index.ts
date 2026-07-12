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
import { generateStructured } from "../_shared/gemini.ts";

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

  // Best-effort audit trail for config changes (never blocks the action).
  const logConfig = async (
    source: string,
    summary: string,
    details: Record<string, unknown> = {},
  ) => {
    try {
      await db.from("config_audit").insert({
        store_id: store.id,
        actor: body.actor ? String(body.actor) : null,
        source,
        summary,
        details,
      });
    } catch (e) {
      console.error(`[bot-admin] audit: ${e instanceof Error ? e.message : e}`);
    }
  };

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
      case "list_request_types": {
        // Per-store request-type definitions the bot's file_request tool offers.
        const { data, error } = await db
          .from("request_types")
          .select("id, key, label, description, fields, enabled, updated_at")
          .eq("store_id", store.id)
          .order("label");
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, request_types: data ?? [] });
      }
      case "set_request_type": {
        const key = String(body.key ?? "").trim().toLowerCase();
        const label = String(body.label ?? "").trim();
        if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) {
          return json({ error: "key must be lowercase letters/numbers/underscores (e.g. career_interest)" }, 400);
        }
        if (!label) return json({ error: "label required" }, 400);
        // deno-lint-ignore no-explicit-any
        const row: Record<string, any> = {
          store_id: store.id,
          key,
          label,
          description: body.description != null ? String(body.description) : null,
          fields: Array.isArray(body.fields) ? body.fields : [],
          enabled: body.enabled === undefined ? true : !!body.enabled,
          updated_at: new Date().toISOString(),
        };
        const { error } = await db.from("request_types").upsert(row, { onConflict: "store_id,key" });
        if (error) return json({ error: error.message }, 500);
        if (body.source !== "nl") await logConfig("manual", `Saved request type “${label}” (${key})`, { key, label });
        return json({ store: store.slug, key, ok: true });
      }
      case "delete_request_type": {
        const key = String(body.key ?? "").trim();
        if (!key) return json({ error: "key required" }, 400);
        const { error } = await db
          .from("request_types")
          .delete()
          .eq("store_id", store.id)
          .eq("key", key);
        if (error) return json({ error: error.message }, 500);
        if (body.source !== "nl") await logConfig("manual", `Removed request type “${key}”`, { key });
        return json({ store: store.slug, key, ok: true });
      }
      case "list_config_audit": {
        const { data, error } = await db
          .from("config_audit")
          .select("id, actor, source, summary, details, created_at")
          .eq("store_id", store.id)
          .order("created_at", { ascending: false })
          .limit(Number(body.limit ?? 20));
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, audit: data ?? [] });
      }
      case "list_requests": {
        // Captured requests (any type) for this store.
        let q = db
          .from("requests")
          .select("id, type, fields, contact_email, contact_phone, status, created_at")
          .eq("store_id", store.id);
        if (body.type) q = q.eq("type", String(body.type));
        const { data, error } = await q
          .order("created_at", { ascending: false })
          .limit(Number(body.limit ?? 200));
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, requests: data ?? [] });
      }
      case "set_request_status": {
        const id = String(body.id ?? "").trim();
        const status = String(body.status ?? "").trim();
        if (!id || !["new", "reviewed", "contacted", "closed"].includes(status)) {
          return json({ error: "id and a valid status are required" }, 400);
        }
        const { error } = await db
          .from("requests")
          .update({ status })
          .eq("id", id)
          .eq("store_id", store.id);
        if (error) return json({ error: error.message }, 500);
        return json({ store: store.slug, id, status, ok: true });
      }
      case "plan_request_config": {
        // Natural-language config: turn an owner's sentence into a STRUCTURED plan
        // (proposal only — no writes). The panel previews it; apply happens on
        // confirm via apply_request_config.
        const instruction = String(body.instruction ?? "").trim();
        if (!instruction) return json({ error: "instruction required" }, 400);
        const [{ data: types }, { data: resp }] = await Promise.all([
          db.from("request_types").select("key, label, fields").eq("store_id", store.id),
          db.from("store_responders").select("name, email, phone, topics").eq("store_slug", store.slug).eq("active", true),
        ]);
        const ctx = [
          "Existing request types:",
          (types ?? []).length
            // deno-lint-ignore no-explicit-any
            ? (types ?? []).map((t: any) => `- ${t.key} (${t.label}); fields: ${JSON.stringify(t.fields ?? [])}`).join("\n")
            : "- (none)",
          "",
          "Existing responders (topics they're subscribed to):",
          (resp ?? []).length
            // deno-lint-ignore no-explicit-any
            ? (resp ?? []).map((r: any) => `- ${r.name ?? r.email ?? r.phone}: [${(r.topics ?? []).join(", ")}]`).join("\n")
            : "- (none)",
        ].join("\n");
        const sys =
          "You convert a store owner's plain-language instruction into a structured plan of " +
          "assistant-config actions. Action kinds:\n" +
          "- upsert_type: create/edit a request the assistant can capture. key = stable lowercase_snake id (also the notification topic); reuse an existing key when editing; label = human name; description = when the bot should file it; fields = the info to collect ({key, required}).\n" +
          "- delete_type: remove a request type (key).\n" +
          "- subscribe / unsubscribe: change who is notified for a topic. topic = a request-type key or the built-ins 'order' / 'escalation'. Identify the person by responder_email, responder_phone, or responder_name.\n" +
          "Rules: for every upsert_type you MUST include the `fields` array — one entry per piece of info to collect (required:true unless clearly optional). Emit a SEPARATE subscribe action for EACH person to notify, with topic = the request type's key. Keep fields minimal; invent a sensible snake_case key for new types; only act on what the instruction clearly asks; if unclear or unrelated, return an empty actions array. Always fill 'summary' with a short plain-English description of what will change (or why nothing will).\n\n" +
          "Respond with ONLY a JSON object of exactly this shape:\n" +
          "{\"summary\": string, \"actions\": [ {\"kind\":\"upsert_type\"|\"delete_type\"|\"subscribe\"|\"unsubscribe\", \"key\"?: string, \"label\"?: string, \"description\"?: string, \"fields\"?: [{\"key\": string, \"required\": boolean}], \"topic\"?: string, \"responder_email\"?: string, \"responder_phone\"?: string, \"responder_name\"?: string} ] }\n\n" +
          "Example — instruction: \"Capture quote requests with product and quantity, and email sam@shop.com about them.\"\n" +
          "Output: {\"summary\":\"Add a Quote request collecting product and quantity, and notify sam@shop.com about quotes.\",\"actions\":[" +
          "{\"kind\":\"upsert_type\",\"key\":\"quote_request\",\"label\":\"Quote request\",\"description\":\"When a visitor asks for a price quote.\",\"fields\":[{\"key\":\"product\",\"required\":true},{\"key\":\"quantity\",\"required\":true}]}," +
          "{\"kind\":\"subscribe\",\"topic\":\"quote_request\",\"responder_email\":\"sam@shop.com\"}]}\n\n" +
          "Current store config:\n" + ctx;
        const plan = await generateStructured(sys, instruction);
        if (!plan) return json({ error: "Couldn't understand that (AI config is unavailable). Try the manual controls." }, 502);
        return json({ store: store.slug, plan });
      }
      case "apply_request_config": {
        // Apply a confirmed structured plan (from plan_request_config). Deterministic.
        // deno-lint-ignore no-explicit-any
        const actions: any[] = Array.isArray(body.actions) ? body.actions : [];
        const applied: string[] = [];
        const skipped: string[] = [];
        // Load responders once for matching.
        const { data: resp } = await db
          .from("store_responders")
          .select("id, name, email, phone, topics")
          .eq("store_slug", store.slug);
        // deno-lint-ignore no-explicit-any
        const responders = (resp ?? []) as any[];
        const digits = (s: string) => (s ?? "").replace(/[^0-9]/g, "");

        for (const a of actions) {
          const kind = String(a?.kind ?? "");
          try {
            if (kind === "upsert_type") {
              let key = String(a.key ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
              const label = String(a.label ?? "").trim();
              if (!key && label) key = label.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
              if (!/^[a-z][a-z0-9_]{1,40}$/.test(key) || !label) { skipped.push(`type "${label || key}" (needs a valid key + label)`); continue; }
              const fields = Array.isArray(a.fields)
                // deno-lint-ignore no-explicit-any
                ? a.fields.filter((f: any) => f && f.key).map((f: any) => ({ key: String(f.key), required: f.required !== false }))
                : [];
              const { error } = await db.from("request_types").upsert({
                store_id: store.id, key, label,
                description: a.description != null ? String(a.description) : null,
                fields, enabled: true, updated_at: new Date().toISOString(),
              }, { onConflict: "store_id,key" });
              if (error) { skipped.push(`type ${key}: ${error.message}`); continue; }
              applied.push(`Request type "${label}" (${key})`);
            } else if (kind === "delete_type") {
              const key = String(a.key ?? "").trim();
              if (!key) { skipped.push("delete type (no key)"); continue; }
              await db.from("request_types").delete().eq("store_id", store.id).eq("key", key);
              applied.push(`Removed request type ${key}`);
            } else if (kind === "subscribe" || kind === "unsubscribe") {
              const topic = String(a.topic ?? "").trim();
              if (!topic) { skipped.push(`${kind} (no topic)`); continue; }
              const email = String(a.responder_email ?? "").trim().toLowerCase();
              const phone = digits(String(a.responder_phone ?? ""));
              const name = String(a.responder_name ?? "").trim().toLowerCase();
              let r = responders.find((x) =>
                (email && (x.email ?? "").toLowerCase() === email) ||
                (phone && digits(x.phone ?? "") === phone) ||
                (name && (x.name ?? "").toLowerCase() === name)
              );
              if (!r) {
                if (kind === "subscribe" && (email || phone)) {
                  const { data: created, error } = await db.from("store_responders").insert({
                    store_slug: store.slug, email: email || null, phone: phone || null,
                    name: a.responder_name ? String(a.responder_name) : null, role: "staff",
                    topics: [topic], active: true,
                  }).select("id, name, email, phone, topics").single();
                  if (error) { skipped.push(`add responder: ${error.message}`); continue; }
                  responders.push(created);
                  applied.push(`Added ${created.email ?? created.phone} and subscribed to ${topic}`);
                } else {
                  skipped.push(`${kind} ${topic} (couldn't find that person; give an email or phone)`);
                }
                continue;
              }
              const cur: string[] = r.topics ?? [];
              const next = kind === "subscribe"
                ? [...new Set([...cur, topic])]
                : cur.filter((t) => t !== topic);
              const { error } = await db.from("store_responders").update({ topics: next }).eq("id", r.id);
              if (error) { skipped.push(`${kind} ${topic}: ${error.message}`); continue; }
              r.topics = next;
              applied.push(`${kind === "subscribe" ? "Subscribed" : "Unsubscribed"} ${r.name ?? r.email ?? r.phone} ${kind === "subscribe" ? "to" : "from"} ${topic}`);
            } else {
              skipped.push(`unknown action: ${kind}`);
            }
          } catch (e) {
            skipped.push(`${kind}: ${e instanceof Error ? e.message : e}`);
          }
        }
        if (applied.length) {
          const summary = body.summary ? String(body.summary) : `Applied ${applied.length} change(s)`;
          await logConfig("nl", summary, {
            instruction: body.instruction ? String(body.instruction) : null,
            applied,
            skipped,
          });
        }
        return json({ store: store.slug, applied, skipped });
      }
      case "connect_stripe": {
        // One-click Stripe: store the owner's key + wire the payment connector
        // to our hosted stripe-pay adapter (which reads this store's key).
        const key = String(body.stripe_key ?? "").trim();
        if (!/^(sk|rk)_/.test(key)) {
          return json({ error: "That doesn't look like a Stripe secret key (it starts with sk_ or rk_)." }, 400);
        }
        const { error: credErr } = await db.from("store_provider_credentials").upsert(
          { store_id: store.id, provider: "stripe", credentials: { secret_key: key }, connected: true, updated_at: new Date().toISOString() },
          { onConflict: "store_id,provider" },
        );
        if (credErr) return json({ error: credErr.message }, 500);
        const { error } = await db.from("store_integrations").upsert({
          store_id: store.id,
          name: "create_payment_link",
          description:
            "Create a secure hosted payment link (Stripe) for the order total. Call after placing the order and share the link. Never take card details in chat.",
          params_schema: { type: "object", properties: { amount: { type: "number", description: "order total including tax" }, order_ref: { type: "string" } }, required: [] },
          kind: "http",
          endpoint_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-pay`,
          auth_secret: Deno.env.get("STRIPE_PAY_SECRET") ?? "",
          side_effect: true,
          enabled: true,
          timeout_ms: 8000,
          updated_at: new Date().toISOString(),
        }, { onConflict: "store_id,name" });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, provider: "stripe" });
      }
      case "connect_demo_pos": {
        // A working demo POS so owners can see the order -> kitchen-ticket flow
        // before a real Toast/Square/Clover adapter is wired.
        await db.from("store_provider_credentials").upsert(
          { store_id: store.id, provider: "demo_pos", credentials: {}, connected: true, updated_at: new Date().toISOString() },
          { onConflict: "store_id,provider" },
        );
        const { error } = await db.from("store_integrations").upsert({
          store_id: store.id,
          name: "place_pos_order",
          description: "Send the confirmed order to the kitchen POS and get a ticket + ETA. Call once the guest confirms their order.",
          params_schema: { type: "object", properties: { items: { type: "array", items: { type: "string" }, description: "ordered items" }, order_type: { type: "string", description: "pickup or delivery" }, total: { type: "number" }, name: { type: "string" } }, required: [] },
          kind: "http",
          endpoint_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mock-restaurant`,
          auth_secret: Deno.env.get("MOCK_RESTAURANT_SECRET") ?? "",
          side_effect: true,
          enabled: true,
          timeout_ms: 8000,
          updated_at: new Date().toISOString(),
        }, { onConflict: "store_id,name" });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, provider: "demo_pos" });
      }
      case "provider_status": {
        const { data } = await db
          .from("store_provider_credentials")
          .select("provider, connected, updated_at")
          .eq("store_id", store.id);
        return json({ providers: data ?? [] });
      }
      case "disconnect_provider": {
        const provider = String(body.provider ?? "");
        await db.from("store_provider_credentials").delete().eq("store_id", store.id).eq("provider", provider);
        if (provider === "stripe") {
          await db.from("store_integrations").delete().eq("store_id", store.id).eq("name", "create_payment_link");
        }
        if (provider === "demo_pos") {
          await db.from("store_integrations").delete().eq("store_id", store.id).eq("name", "place_pos_order");
        }
        return json({ ok: true });
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
