// followup — proactive silence check-back (Bot Phase 5).
//
// Driven by pg_cron once a minute (it POSTs here with the public anon key, which
// satisfies the gateway; this function uses its own service role internally).
// It fires at most one gentle check-back per pending row: for each conversation
// that went quiet past its due time, it asks the model whether a nudge makes
// sense (SKIP if the chat was already finished) and, if so, delivers it —
// WhatsApp within the 24h service window (no template) or web via Realtime.

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug, getStoreAccessToken } from "../_shared/config.ts";
import { loadAgentConfig } from "../_shared/agent.ts";
import { loadHistory } from "../_shared/history.ts";
import { buildContents, shouldBotRespond } from "../_shared/prompt.ts";
import { generateReply } from "../_shared/gemini.ts";
import { sendText } from "../_shared/wa.ts";

const MAX_PER_RUN = 25;

Deno.serve(async () => {
  const db = serviceClient();

  // Atomically claim due rows so overlapping cron ticks can't double-send.
  const { data: claimed, error } = await db
    .from("pending_followups")
    .update({ status: "processing" })
    .eq("status", "pending")
    .lte("due_at", new Date().toISOString())
    .select("*")
    .limit(MAX_PER_RUN);
  if (error) {
    console.error("[followup] claim:", error.message);
    return json({ error: error.message }, 500);
  }
  const rows = claimed ?? [];
  let sent = 0, skipped = 0;

  for (const row of rows) {
    try {
      const outcome = await processOne(db, row);
      if (outcome === "sent") sent++;
      else skipped++;
      await db.from("pending_followups").update({ status: outcome }).eq("id", row.id);
    } catch (e) {
      console.error(`[followup] ${row.session_id}:`, e);
      // Leave as 'skipped' so a stuck row doesn't get retried forever; a new
      // customer message re-arms it to 'pending' anyway.
      await db.from("pending_followups").update({ status: "skipped" }).eq("id", row.id);
      skipped++;
    }
  }

  return json({ claimed: rows.length, sent, skipped });
});

// deno-lint-ignore no-explicit-any
async function processOne(db: any, row: any): Promise<"sent" | "skipped"> {
  const store = await getStoreBySlug(db, row.store_slug);
  if (!store) return "skipped";

  // If an owner took over the thread, stay silent.
  const { data: thread } = await db
    .from("threads")
    .select("routing_state")
    .eq("thread_id", row.thread_id)
    .maybeSingle();
  if (!shouldBotRespond(thread?.routing_state)) return "skipped";

  const config = await loadAgentConfig(db, store);
  const history = await loadHistory(db, store.slug, row.session_id, config.historyTurns);
  if (history.length === 0) return "skipped"; // nothing to check back on

  const instruction = buildNudgeInstruction(store.store_display_name ?? store.slug, config);
  const contents = buildContents(
    history,
    "[The customer has gone quiet for a few minutes since your last message. Follow your check-back instructions now.]",
  );
  const { text } = await generateReply(instruction, contents);
  const nudge = (text ?? "").trim();
  // Model declined, or produced nothing usable.
  if (!nudge || /^skip\b/i.test(nudge) || nudge.toUpperCase() === "SKIP") return "skipped";

  const now = new Date().toISOString();
  if (row.channel === "web") {
    await db.from("thread_messages").insert({
      message_id: `msg_web_nudge_${crypto.randomUUID()}`,
      thread_id: row.thread_id,
      store_slug: store.slug,
      customer_phone: row.session_id,
      direction: "outbound",
      sender: "agent",
      text: nudge,
      kind: "message",
      created_at: now,
    });
    return "sent";
  }

  // WhatsApp: send within the 24h service window (no template needed).
  const token = await getStoreAccessToken(db, store.id);
  if (!token || !row.phone_number_id) return "skipped";
  await sendText(token, row.phone_number_id, row.customer_ref, nudge); // best-effort, never throws
  await db.from("thread_messages").insert({
    message_id: `msg_out_nudge_${crypto.randomUUID()}`,
    thread_id: row.thread_id,
    store_slug: store.slug,
    customer_phone: row.customer_ref,
    direction: "outbound",
    sender: "agent",
    text: nudge,
    kind: "message",
    created_at: now,
  });
  return "sent";
}

// deno-lint-ignore no-explicit-any
function buildNudgeInstruction(storeName: string, config: any): string {
  const out: string[] = [];
  out.push(
    `You are Rani, the assistant for ${storeName}. A customer chatted with you and then ` +
      `went quiet for a few minutes. The conversation so far is shown.`,
  );
  out.push(
    "Decide whether a gentle check-back makes sense:\n" +
      "- If the conversation was clearly finished — they said goodbye, got what they came " +
      "for, or completed their task — reply with EXACTLY the single word SKIP and nothing else.\n" +
      "- Otherwise write ONE short, warm check-back (one or two sentences) that picks up from " +
      "where they left off: offer to continue an unfinished order, answer a lingering question, " +
      "or help with the next step. Do not repeat your last message. Keep it light — a friendly " +
      "nudge, never pressure.",
  );
  out.push("Reply in the same language and script the customer was using. No markdown — plain sentences only.");
  if (config.personality) out.push(`\n## Personality\n${config.personality}`);
  if (config.languageHandling) out.push(`\n## Language\n${config.languageHandling}`);
  if (config.promotions && String(config.promotions).trim()) {
    out.push(
      `\n## Promotions\n${String(config.promotions).trim()}\n\n` +
        "A check-back can be a natural moment for a promotion — but only if one genuinely fits " +
        "here. Weave it in briefly and at most once, or leave it out entirely. Never make the " +
        "nudge feel like an ad, and follow the store's pricing rules.",
    );
  }
  return out.join("\n");
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
