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
import { learnFromAnswer } from "./learn.ts";
import { sendEmail } from "./email.ts";

const PANEL_URL = "https://app.askrani.ai";

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

/** Notify responders opted into a given kind — on every channel they've set
 *  (WhatsApp DM to their phone, email to their address). */
export async function notifyResponders(
  db: SupabaseClient,
  store: Store,
  topic: string,
  text: string,
  opts?: { subject?: string; emailBody?: string },
): Promise<void> {
  // Topic-based subscriptions: notify anyone subscribed to this topic (or '*').
  // 'order' / 'escalation' are built-in topics; request-type keys are dynamic.
  const { data } = await db
    .from("store_responders")
    .select("phone, email")
    .eq("store_slug", store.slug)
    .eq("active", true)
    .or(`topics.cs.{${topic}},topics.cs.{*}`);
  const rows = (data ?? []) as { phone: string | null; email: string | null }[];

  const phones = rows.map((r) => r.phone).filter((p): p is string => !!p);
  await notify(db, store, phones, text);

  const emails = rows.map((r) => r.email).filter((e): e is string => !!e);
  if (emails.length) {
    const name = store.store_display_name ?? store.slug;
    const subject = opts?.subject ??
      (topic === "order" ? `New order — ${name}` : `A customer needs help — ${name}`);
    const body = opts?.emailBody ??
      `${text}\n\nOpen your dashboard to respond: ${PANEL_URL}/tickets`;
    for (const to of emails) await sendEmail(to, subject, body, name);
  }
}

/**
 * Relay a WhatsApp responder's reply to the waiting customer. Answers the single
 * open ticket for the store; if zero or many are open, returns a note so the
 * caller can ack the responder appropriately.
 */
export async function relayStaffAnswer(
  db: SupabaseClient,
  store: Store,
  _phoneNumberId: string,
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
  return await deliverTicketAnswer(
    db, store, tickets[0], answerText, responder.name ?? responder.phone ?? "a teammate", responder.phone ?? null,
  );
}

/**
 * Answer a SPECIFIC ticket from the dashboard (any owner/staff, incl. email-only
 * responders who can't reply over WhatsApp). Same delivery as a WhatsApp reply.
 */
export async function answerTicket(
  db: SupabaseClient,
  store: Store,
  ticketId: string,
  answerText: string,
  by: string,
): Promise<{ handled: boolean; note?: string }> {
  const { data: t } = await db
    .from("tickets")
    .select("ticket_id, customer_phone, question, status")
    .eq("store_slug", store.slug)
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (!t) return { handled: false, note: "not_found" };
  if (t.status !== "created" && t.status !== "sent_to_owner") {
    return { handled: false, note: "already_answered" };
  }
  return await deliverTicketAnswer(db, store, t, answerText, by, null);
}

/** Shared: atomically claim the ticket (first-to-answer wins across WhatsApp and
 *  the panel), relay to the customer, persist, learn, and notify the team. */
async function deliverTicketAnswer(
  db: SupabaseClient,
  store: Store,
  ticket: { ticket_id: string; customer_phone: string | null; question: string | null },
  answerText: string,
  by: string,
  excludePhone: string | null,
): Promise<{ handled: boolean; note?: string }> {
  const { data: claimed } = await db
    .from("tickets")
    .update({ status: "answered", answer: answerText, answered_by: by, answered_at: new Date().toISOString() })
    .eq("ticket_id", ticket.ticket_id)
    .in("status", ["created", "sent_to_owner"])
    .select("ticket_id");
  if (!claimed || claimed.length === 0) return { handled: false, note: "already_answered" };

  // Relay to the customer as Rani. Web sessions (customer_phone = web_<uuid>)
  // have no phone — the thread write below is delivered live via Realtime instead.
  const isWeb = (ticket.customer_phone ?? "").startsWith("web_");
  const token = await getStoreAccessToken(db, store.id);
  if (token && ticket.customer_phone && !isWeb && store.whatsapp_phone_number_id) {
    await sendText(token, store.whatsapp_phone_number_id, ticket.customer_phone, answerText);
  }

  const threadId = `thr_${ticket.customer_phone}_${store.slug}`;
  await db.from("thread_messages").insert({
    message_id: `msg_out_${crypto.randomUUID()}`,
    thread_id: threadId, store_slug: store.slug, customer_phone: ticket.customer_phone,
    direction: "outbound", sender: by, text: answerText, kind: "message",
  });
  await db.from("thread_messages").insert({
    message_id: `evt_${crypto.randomUUID()}`,
    thread_id: threadId, store_slug: store.slug, customer_phone: ticket.customer_phone,
    direction: "system", sender: "bot", kind: "event", event_type: "ticket_answered",
    text: `${by} answered: ${ticket.question}`, event_payload_json: { ticket_id: ticket.ticket_id, by },
  });

  // Learn from this answer (best-effort; never blocks the relay).
  try {
    await learnFromAnswer(db, store, ticket.question ?? "", answerText, ticket.customer_phone);
  } catch (e) {
    console.error(`[responders] learn: ${e instanceof Error ? e.message : e}`);
  }

  // Tell the other responders it's handled.
  let others = db
    .from("store_responders")
    .select("phone")
    .eq("store_slug", store.slug)
    .eq("active", true)
    .eq("notify_escalations", true);
  if (excludePhone) others = others.neq("phone", excludePhone);
  const { data: rest } = await others;
  await notify(
    db, store,
    (rest ?? []).map((r: { phone: string | null }) => r.phone).filter((p): p is string => !!p),
    `Handled: "${ticket.question}" — answered by ${by}.`,
  );

  return { handled: true };
}
