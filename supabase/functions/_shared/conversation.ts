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
  splitBubbles,
} from "./prompt.ts";
import { generateReply, type GeminiReply } from "./gemini.ts";
import { buildToolset } from "./tools.ts";
import { getPendingProposals } from "./order.ts";
import { buildNowContext } from "./clock.ts";
import { classifyTurn } from "./analytics.ts";
import { getStoreAccessToken } from "./config.ts";
import { sendText } from "./wa.ts";
import { loadStoreIntegrations } from "./integrations.ts";
import {
  cancelFollowup,
  getFollowupSettings,
  isLikelyClosing,
  scheduleFollowup,
} from "./followup.ts";

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
  opts: {
    sessionId: string;
    inboundText: string;
    image?: { base64: string; mime: string }; // a photo the customer just sent
  },
): Promise<GeminiReply> {
  const config = await loadAgentConfig(db, store);
  const history = await loadHistory(db, store.slug, opts.sessionId, config.historyTurns);
  // Per-store connectors — loaded before the prompt so a live-price connector can
  // lift the request-mode no-price rule. Empty for stores with none → no change.
  const integrations = await loadStoreIntegrations(db, store.id);
  const systemInstruction = buildSystemInstruction(config, { hasConnector: integrations.length > 0 });
  // Prefix the CURRENT message (volatile — not the cached prefix) with store-local
  // date/time + open/closed, and any pending priced proposal awaiting a decision.
  const nowCtx = buildNowContext(config.timezone, config.storeHours);
  let proposalCtx = "";
  let hasProposal = false;
  if (config.ordersEnabled) {
    const proposals = await getPendingProposals(db, store, opts.sessionId);
    if (proposals.length > 0) {
      hasProposal = true;
      proposalCtx = "\n" + proposals
        .map((p) => `[PENDING PROPOSAL: order ${p.order_id}, total ${p.total != null ? "$" + p.total : "to be confirmed"}, awaiting the customer's decision]`)
        .join("\n");
    }
  }
  const contents = buildContents(history, `${nowCtx}${proposalCtx}\n${opts.inboundText}`);
  // Attach the customer's photo (if any) to the current user turn so the model sees it.
  if (opts.image && contents.length > 0) {
    contents[contents.length - 1].parts.unshift({
      inlineData: { mimeType: opts.image.mime, data: opts.image.base64 },
    });
  }
  // Store-local date (YYYY-MM-DD) so knowledge retrieval can hide entries that
  // are outside their effective window (expired promos, not-yet-active notices).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const toolset = buildToolset(
    db, store, opts.sessionId, config.ordersEnabled, hasProposal, config.catalogEnabled, today, integrations,
  );
  return await generateReply(systemInstruction, contents, toolset);
}

export interface ConversationContext {
  threadId: string;
  sessionId: string; // wa_<phone>
  customerPhone: string;
  phoneNumberId: string;
  inboundText: string;
  image?: { base64: string; mime: string }; // a photo the customer sent, if any
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

  // The customer just messaged — clear any pending silence check-back (a fresh
  // one is scheduled after this reply if the chat is still open).
  await cancelFollowup(db, store.id, ctx.sessionId);

  // ── Generate the reply (tool loop; no-op without GEMINI_API_KEY). ───────────
  const startedAt = Date.now();
  const { text: reply, toolsUsed } = await generateTurnReply(db, store, {
    sessionId: ctx.sessionId,
    inboundText: ctx.inboundText,
    image: ctx.image,
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
  const conversationId = await logTurn(db, store, ctx, reply, responseTimeMs);
  await sendAndPersist(db, store, ctx, reply);

  // Schedule a single silence check-back unless the customer is clearly wrapping up.
  try {
    const fu = await getFollowupSettings(db, store.id);
    if (fu.enabled && !isLikelyClosing(ctx.inboundText) && !isLikelyClosing(reply)) {
      await scheduleFollowup(db, {
        storeId: store.id,
        storeSlug: store.slug,
        sessionId: ctx.sessionId,
        channel: "whatsapp",
        threadId: ctx.threadId,
        customerRef: ctx.customerPhone,
        phoneNumberId: ctx.phoneNumberId,
        minutes: fu.minutes,
      });
    }
  } catch (e) {
    console.error("[conv] followup schedule:", e);
  }

  // Enrich analytics AFTER the reply is sent — never blocks the customer's reply.
  if (conversationId) {
    const analytics = await classifyTurn(ctx.inboundText, reply);
    await db
      .from("conversations")
      .update({ analytics_json: JSON.stringify(analytics) })
      .eq("conversation_id", conversationId);
  }
}

async function logTurn(
  db: SupabaseClient,
  store: Store,
  ctx: ConversationContext,
  reply: string,
  responseTimeMs: number,
): Promise<string | null> {
  const now = new Date().toISOString();
  const conversationId = `wa-${crypto.randomUUID()}`;
  const { error } = await db.from("conversations").insert({
    conversation_id: conversationId,
    store_slug: store.slug,
    session_id: ctx.sessionId,
    timestamp: now,
    user_message: ctx.inboundText,
    assistant_response: reply,
    response_time_ms: responseTimeMs,
    device_type: ctx.deviceType,
    // Provisional language tag; enriched with full analytics after the reply.
    analytics_json: JSON.stringify({ language: detectLanguage(ctx.inboundText) }),
    synced_to_master: false,
  });
  if (error) {
    console.error(`[conv] log turn: ${error.message}`);
    return null;
  }
  return conversationId;
}

async function sendAndPersist(
  db: SupabaseClient,
  store: Store,
  ctx: ConversationContext,
  reply: string,
): Promise<void> {
  const token = await getStoreAccessToken(db, store.id);
  if (!token) {
    console.warn(`[conv] no access token for ${store.slug}; reply logged but not sent`);
  }

  // A reply may be a few short messages (the model marks breaks with ---). Send
  // and persist each as its own bubble, in order, with a brief human pause.
  const bubbles = splitBubbles(reply);
  for (let i = 0; i < bubbles.length; i++) {
    const part = bubbles[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 700));
    if (token) await sendText(token, ctx.phoneNumberId, ctx.customerPhone, part);
    // Append-only outbound record (no wamid: send is best-effort and async).
    const { error } = await db.from("thread_messages").insert({
      message_id: `msg_out_${crypto.randomUUID()}`,
      thread_id: ctx.threadId,
      store_slug: store.slug,
      customer_phone: ctx.customerPhone,
      direction: "outbound",
      sender: "agent",
      text: part,
      kind: "message",
      created_at: new Date().toISOString(),
    });
    if (error) console.error(`[conv] persist outbound: ${error.message}`);
  }

  await db.from("threads").update({ last_message_at: new Date().toISOString() }).eq(
    "thread_id",
    ctx.threadId,
  );
}
