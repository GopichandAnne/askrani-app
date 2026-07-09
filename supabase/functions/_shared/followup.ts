// Silence check-back — schedule/cancel a single proactive nudge when a customer
// goes quiet mid-conversation. Conversations are always customer-initiated, so a
// nudge ~N minutes after the customer's last message is inside WhatsApp's 24h
// service window (no template needed) and delivered live over Realtime on web.
//
// Flow: after each bot reply we SCHEDULE one pending_followup (due = now + N min);
// on the next inbound we CANCEL it (they replied). If it's never canceled, the
// `followup` edge function (driven by pg_cron) fires exactly one check-back and
// consumes the row. One pending row per session (unique on store_id, session_id).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_MINUTES = 5;
const MIN_MINUTES = 1;
const MAX_MINUTES = 180;

export type FollowupChannel = "whatsapp" | "web";

export interface FollowupSettings {
  enabled: boolean;
  minutes: number;
}

/** Read the store's check-back settings. Defaults: ON, 5 minutes (the feature is
 *  opt-out). Absent/blank followup_enabled = enabled. */
export async function getFollowupSettings(
  db: SupabaseClient,
  storeId: string,
): Promise<FollowupSettings> {
  const { data } = await db
    .from("agent_config")
    .select("key, value")
    .eq("store_id", storeId)
    .in("key", ["followup_enabled", "followup_minutes"]);
  const m = new Map<string, string | null>(
    (data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  );
  const enabled = (m.get("followup_enabled") ?? "true").toLowerCase() !== "false";
  const parsed = parseInt(m.get("followup_minutes") ?? "", 10);
  const minutes = Number.isFinite(parsed)
    ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, parsed))
    : DEFAULT_MINUTES;
  return { enabled, minutes };
}

/**
 * Heuristic: does this message read like the conversation is wrapping up? Used to
 * SKIP scheduling a nudge after a goodbye so we don't ping someone who just left.
 * Deliberately conservative — the followup function also gets a final say (SKIP).
 */
export function isLikelyClosing(text: string | null | undefined): boolean {
  const t = (text ?? "").toLowerCase().trim();
  if (!t) return false;
  // Short pure-thanks / farewell messages.
  if (/^(ok|okay|k|thanks|thank you|thx|ty|great|cool|got it|👍|🙏|no|nope|no thanks)[.! ]*$/.test(t)) {
    return true;
  }
  return /\b(bye|goodbye|good night|goodnight|see you|see ya|cya|take care|that'?s all|that is all|nothing else|i'?m good|im good|we'?re good|catch you later|talk later|later)\b/
    .test(t);
}

/** Remove any pending nudge for this session — called when the customer replies. */
export async function cancelFollowup(
  db: SupabaseClient,
  storeId: string,
  sessionId: string,
): Promise<void> {
  const { error } = await db
    .from("pending_followups")
    .delete()
    .eq("store_id", storeId)
    .eq("session_id", sessionId);
  if (error) console.error(`[followup] cancel ${sessionId}: ${error.message}`);
}

export interface ScheduleParams {
  storeId: string;
  storeSlug: string;
  sessionId: string;
  channel: FollowupChannel;
  threadId: string;
  customerRef: string; // WhatsApp phone (digits) or the web_ session id
  phoneNumberId?: string | null; // WhatsApp only
  minutes: number;
}

/** Schedule (or replace) the single pending nudge for this session. */
export async function scheduleFollowup(
  db: SupabaseClient,
  p: ScheduleParams,
): Promise<void> {
  const dueAt = new Date(Date.now() + p.minutes * 60_000).toISOString();
  const { error } = await db.from("pending_followups").upsert(
    {
      store_id: p.storeId,
      store_slug: p.storeSlug,
      session_id: p.sessionId,
      channel: p.channel,
      thread_id: p.threadId,
      customer_ref: p.customerRef,
      phone_number_id: p.phoneNumberId ?? null,
      due_at: dueAt,
      status: "pending",
    },
    { onConflict: "store_id,session_id" },
  );
  if (error) console.error(`[followup] schedule ${p.sessionId}: ${error.message}`);
}
