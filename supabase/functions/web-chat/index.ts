// web-chat — public web chat transport (Bot Phase 4).
//
// The browser at askrani.ai/s/<slug> POSTs a message here. This is a thin
// transport around the SAME core as WhatsApp (generateTurnReply): it persists
// the turn, runs the full toolset (search, knowledge, cart, escalate, ...) and
// returns the reply synchronously — no WhatsApp send.
//
// Public but gated: verify_jwt stays on, so the browser must send the project
// anon key (a valid JWT). Plus a per-session rate limit as an abuse backstop.

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug } from "../_shared/config.ts";
import { generateTurnReply } from "../_shared/conversation.ts";
import { classifyTurn } from "../_shared/analytics.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_MSG_LEN = 1000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20; // inbound messages per session per minute

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const slug = String(body.slug ?? "").trim();
  const sessionId = String(body.session_id ?? "").trim();
  const message = String(body.message ?? "").trim().slice(0, MAX_MSG_LEN);
  if (!slug || !sessionId || !message) {
    return json({ error: "slug, session_id and message are required" }, 400);
  }
  if (!sessionId.startsWith("web_")) return json({ error: "invalid session" }, 400);

  const db = serviceClient();
  const store = await getStoreBySlug(db, slug);
  if (!store) return json({ error: "unknown store" }, 404);

  const threadId = `thr_${sessionId}_${store.slug}`;

  // ── Rate limit: inbound messages in the last minute for this session. ──
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("thread_messages")
    .select("message_id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("direction", "inbound")
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_MAX) {
    return json({ error: "You're sending messages very fast — please slow down a moment." }, 429);
  }

  const now = new Date().toISOString();

  // ── Persist the thread + inbound message (customer_phone stands in as the web id). ──
  await db.from("threads").upsert(
    { thread_id: threadId, store_slug: store.slug, customer_phone: sessionId, last_message_at: now },
    { onConflict: "thread_id" },
  );
  await db.from("thread_messages").insert({
    message_id: `msg_web_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: sessionId,
    direction: "inbound",
    sender: "customer",
    text: message,
    kind: "message",
    created_at: now,
  });

  // ── Generate the reply with the full toolset (identical to WhatsApp). ──
  const startedAt = Date.now();
  const { text: reply, toolsUsed } = await generateTurnReply(db, store, {
    sessionId,
    inboundText: message,
  });
  const responseTimeMs = Date.now() - startedAt;
  const finalReply = reply || "Sorry, I had a brief hiccup — could you send that again? 🙏";

  // ── Persist outbound + conversation. ──
  const outNow = new Date().toISOString();
  await db.from("thread_messages").insert({
    message_id: `msg_web_out_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: sessionId,
    direction: "outbound",
    sender: "agent",
    text: finalReply,
    kind: "message",
    created_at: outNow,
  });
  await db.from("threads").update({ last_message_at: outNow }).eq("thread_id", threadId);

  const conversationId = `web-${crypto.randomUUID()}`;
  await db.from("conversations").insert({
    conversation_id: conversationId,
    store_slug: store.slug,
    session_id: sessionId,
    timestamp: now,
    user_message: message,
    assistant_response: finalReply,
    response_time_ms: responseTimeMs,
    device_type: "web",
    analytics_json: JSON.stringify({}),
    synced_to_master: false,
  });

  // Enrich analytics after replying — never blocks the response.
  const enrich = classifyTurn(message, finalReply)
    .then((a) =>
      db.from("conversations").update({ analytics_json: JSON.stringify(a) }).eq(
        "conversation_id",
        conversationId,
      )
    )
    .catch((e) => console.error("[web-chat] analytics:", e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(enrich);

  return json({ reply: finalReply, toolsUsed });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
