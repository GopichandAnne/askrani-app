// Conversation core — Bot Phases 2–3. Orchestrates one inbound turn:
//   routing gate -> load history -> assemble prefix-first prompt -> Gemini
//   function-calling loop (search_products, ...) -> log turn (conversations) +
//   send reply + persist outbound (thread_messages).
//
// The inbound message has already been persisted by the webhook (Phase 1) and
// deduped on wamid, so this runs at most once per real message. Every step is
// best-effort: a failure logs and returns rather than throwing.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { loadAgentConfig } from "./agent.ts";
import { loadHistory } from "./history.ts";
import {
  buildContents,
  buildSystemInstruction,
  detectLanguage,
  shouldBotRespond,
} from "./prompt.ts";
import { generateReply, type GeminiReply } from "./gemini.ts";
import { buildToolset } from "./tools.ts";
import { getStoreAccessToken } from "./config.ts";
import { sendText } from "./wa.ts";

/**
 * Produce Rani's reply for one turn: load config + history, assemble the
 * prefix-first prompt, and run the Gemini function-calling loop with the store's
 * toolset (search_products; search_knowledge in 3b). No routing gate, logging,
 * or WhatsApp send — callers layer those on. Reused by the webhook and the
 * bot-admin `chat` debug action.
 */
export async function generateTurnReply(
  db: SupabaseClient,
  store: Store,
  opts: { sessionId: string; inboundText: string },
): Promise<GeminiReply> {
  const config = await loadAgentConfig(db, store);
  const history = await loadHistory(db, store.slug, opts.sessionId, config.historyTurns);
  const systemInstruction = buildSystemInstruction(config);
  const contents = buildContents(history, opts.inboundText);
  const toolset = buildToolset(db, store, opts.sessionId, config.ordersEnabled);
  return await generateReply(systemInstruction, contents, toolset);
}

export interface ConversationContext {
  threadId: string;
  sessionId: string; // wa_<phone>
  customerPhone: string;
  phoneNumberId: string;
  inboundText: string;
  deviceType: "whatsapp" | "web";
}

export async function handleConversation(
  db: SupabaseClient,
  store: Store,
  ctx: ConversationContext,
): Promise<void> {
  // ── Routing gate: if an owner has taken the thread, the bot stays silent. ──
  const { data: thread } = await db
    .from("threads")
    .select("routing_state")
    .eq("thread_id", ctx.threadId)
    .maybeSingle();
  if (!shouldBotRespond(thread?.routing_state)) {
    console.log(`[conv] ${ctx.threadId} owner-handled — bot silent`);
    return;
  }

  // ── Generate the reply (tool loop; no-op without GEMINI_API_KEY). ───────────
  const startedAt = Date.now();
  const { text: reply, toolsUsed } = await generateTurnReply(db, store, {
    sessionId: ctx.sessionId,
    inboundText: ctx.inboundText,
  });
  const responseTimeMs = Date.now() - startedAt;
  if (!reply) {
    // A failed generation (transient Gemini/tool error, no key) must NOT leave
    // the customer with silence — send a graceful fallback so they can retry.
    console.warn(`[conv] no reply for ${ctx.threadId} — sending fallback`);
    await sendAndPersist(
      db,
      store,
      ctx,
      "Sorry, I had a brief hiccup just now — could you send that again? 🙏",
    );
    return;
  }
  if (toolsUsed.length) console.log(`[conv] ${ctx.threadId} tools: ${toolsUsed.join(", ")}`);

  // ── Log the turn + send + persist outbound. ────────────────────────────────
  await logTurn(db, store, ctx, reply, responseTimeMs);
  await sendAndPersist(db, store, ctx, reply);
}

async function logTurn(
  db: SupabaseClient,
  store: Store,
  ctx: ConversationContext,
  reply: string,
  responseTimeMs: number,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from("conversations").insert({
    conversation_id: `wa-${crypto.randomUUID()}`,
    store_slug: store.slug,
    session_id: ctx.sessionId,
    timestamp: now,
    user_message: ctx.inboundText,
    assistant_response: reply,
    response_time_ms: responseTimeMs,
    device_type: ctx.deviceType,
    analytics_json: JSON.stringify({ language: detectLanguage(ctx.inboundText) }),
    synced_to_master: false,
  });
  if (error) console.error(`[conv] log turn: ${error.message}`);
}

async function sendAndPersist(
  db: SupabaseClient,
  store: Store,
  ctx: ConversationContext,
  reply: string,
): Promise<void> {
  const now = new Date().toISOString();

  const token = await getStoreAccessToken(db, store.id);
  if (token) {
    await sendText(token, ctx.phoneNumberId, ctx.customerPhone, reply);
  } else {
    console.warn(`[conv] no access token for ${store.slug}; reply logged but not sent`);
  }

  // Append-only outbound record (no wamid: send is best-effort and async).
  const { error } = await db.from("thread_messages").insert({
    message_id: `msg_out_${crypto.randomUUID()}`,
    thread_id: ctx.threadId,
    store_slug: store.slug,
    customer_phone: ctx.customerPhone,
    direction: "outbound",
    sender: "agent",
    text: reply,
    kind: "message",
    created_at: now,
  });
  if (error) console.error(`[conv] persist outbound: ${error.message}`);

  await db.from("threads").update({ last_message_at: now }).eq("thread_id", ctx.threadId);
}
