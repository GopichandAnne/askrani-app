// Staff/owner escalation responders — Bot Phase 3e. Rani DMs responders 1:1
// (the Cloud API cannot join groups); when a responder replies to Rani's number
// the webhook relays their answer to the customer. First-to-answer wins.
//
// NOTE ON DELIVERY: proactive DMs to a responder who hasn't messaged Rani in the
// last 24h require a Meta-approved template (session-window rule). notify() sends
// plain text (works in-window / testing); production should switch to a template.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { sendText } from "./wa.ts";
import { getStoreAccessToken } from "./config.ts";

export interface Responder {
  phone: string;
  name: string | null;
  role: string;
}

/** Is this phone a registered (active) responder for the store? */
export async function findResponder(
  db: SupabaseClient,
  storeSlug: string,
  phone: string,
): Promise<Responder | null> {
  const { data } = await db
    .from("store_responders")
    .select("phone, name, role")
    .eq("store_slug", storeSlug)
    .eq("phone", phone)
    .eq("active", true)
    .maybeSingle();
  return (data as Responder) ?? null;
}

async function notify(db: SupabaseClient, store: Store, phones: string[], text: string): Promise<void> {
  if (phones.length === 0) return;
  const token = await getStoreAccessToken(db, store.id);
  const pnid = store.whatsapp_phone_number_id;
  if (!token || !pnid) {
    console.warn(`[responders] no token/phone_number_id for ${store.slug}; skipping notify`);
    return;
  }
  for (const p of phones) await sendText(token, pnid, p, text); // best-effort
}

/** DM responders opted into a given notification kind. */
export async function notifyResponders(
  db: SupabaseClient,
  store: Store,
  kind: "escalation" | "order",
  text: string,
): Promise<void> {
  const col = kind === "order" ? "notify_orders" : "notify_escalations";
  const { data } = await db
    .from("store_responders")
    .select("phone")
    .eq("store_slug", store.slug)
    .eq("active", true)
    .eq(col, true);
  await notify(db, store, (data ?? []).map((r: { phone: string }) => r.phone), text);
}

/**
 * Relay a responder's reply to the waiting customer. Answers the single open
 * ticket for the store (atomic claim → first-to-answer wins); if zero or many
 * are open, returns a note so the caller can ack the responder appropriately.
 */
export async function relayStaffAnswer(
  db: SupabaseClient,
  store: Store,
  phoneNumberId: string,
  responder: Responder,
  answerText: string,
): Promise<{ handled: boolean; note?: string }> {
  const { data: open } = await db
    .from("tickets")
    .select("ticket_id, customer_phone, question")
    .eq("store_slug", store.slug)
    .in("status", ["created", "sent_to_owner"])
    .order("created_at", { ascending: true });
  const tickets = open ?? [];
  if (tickets.length === 0) return { handled: false, note: "no_open_tickets" };
  if (tickets.length > 1) return { handled: false, note: "multiple_open" };

  const t = tickets[0];
  const by = responder.name ?? responder.phone;
  // Atomic claim: only succeeds if the ticket is still open (first-to-answer).
  const { data: claimed } = await db
    .from("tickets")
    .update({ status: "answered", answer: answerText, answered_by: by, answered_at: new Date().toISOString() })
    .eq("ticket_id", t.ticket_id)
    .in("status", ["created", "sent_to_owner"])
    .select("ticket_id");
  if (!claimed || claimed.length === 0) return { handled: false, note: "already_answered" };

  // Relay to the customer as Rani. Web sessions (customer_phone = web_<uuid>)
  // have no phone — the thread write below is delivered live via Realtime instead.
  const isWeb = (t.customer_phone ?? "").startsWith("web_");
  const token = await getStoreAccessToken(db, store.id);
  if (token && t.customer_phone && !isWeb) {
    await sendText(token, phoneNumberId, t.customer_phone, answerText);
  }

  // Persist to the customer's thread: the answer + an event.
  const threadId = `thr_${t.customer_phone}_${store.slug}`;
  await db.from("thread_messages").insert({
    message_id: `msg_out_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: t.customer_phone,
    direction: "outbound",
    sender: by,
    text: answerText,
    kind: "message",
  });
  await db.from("thread_messages").insert({
    message_id: `evt_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: t.customer_phone,
    direction: "system",
    sender: "bot",
    kind: "event",
    event_type: "ticket_answered",
    text: `${by} answered: ${t.question}`,
    event_payload_json: { ticket_id: t.ticket_id, by },
  });

  // Tell the other responders it's handled.
  const { data: others } = await db
    .from("store_responders")
    .select("phone")
    .eq("store_slug", store.slug)
    .eq("active", true)
    .eq("notify_escalations", true)
    .neq("phone", responder.phone);
  await notify(db, store, (others ?? []).map((r: { phone: string }) => r.phone),
    `Handled: "${t.question}" — answered by ${responder.name ?? "a teammate"}.`);

  return { handled: true };
}
