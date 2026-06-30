// Conversation core — Bot Phase 2. Orchestrates one inbound turn:
//   routing gate -> load history -> assemble prefix-first prompt -> Gemini ->
//   log turn (conversations) + send reply + persist outbound (thread_messages).
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
import { generateReply } from "./gemini.ts";
import { getStoreAccessToken } from "./config.ts";
import { sendText } from "./wa.ts";

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

  // ── Assemble prefix-first prompt. ──────────────────────────────────────────
  const config = await loadAgentConfig(db, store);
  const history = await loadHistory(db, store.slug, ctx.sessionId, config.historyTurns);
  const systemInstruction = buildSystemInstruction(config);
  const contents = buildContents(history, ctx.inboundText);

  // ── Generate (no-op without GEMINI_API_KEY). ───────────────────────────────
  const startedAt = Date.now();
  const { text: reply } = await generateReply(systemInstruction, contents);
  const responseTimeMs = Date.now() - startedAt;
  if (!reply) {
    console.warn(`[conv] no reply for ${ctx.threadId} (no key or generation failed)`);
    return;
  }

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
