"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/wa/send";
import type { ConversationMessage, RoutingState } from "@/lib/conversations/types";

const MSG_COLUMNS =
  "message_id, created_at, direction, sender, text, kind, media_url, event_type, related_order_id";

export type SendResult =
  | { ok: true; message: ConversationMessage }
  | { ok: false; error: string };

/**
 * Send a manual reply to the customer as Rani (used while an owner/staff has
 * taken over a conversation). Delivers over WhatsApp from the store's number,
 * then persists the outbound message to the thread. RLS scopes the thread load
 * to the caller's stores, so only a member of the store can reply.
 */
export async function sendMessage(threadId: string, text: string): Promise<SendResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: "Message is empty." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const actor = user?.email ?? user?.id ?? "staff";

  const { data: thread } = await supabase
    .from("threads")
    .select("store_slug, customer_phone")
    .eq("thread_id", threadId)
    .maybeSingle();
  if (!thread) return { ok: false, error: "Thread not found." };
  if (!thread.customer_phone) return { ok: false, error: "No customer phone on this thread." };

  const sent = await sendWhatsAppText(thread.store_slug, thread.customer_phone, body);
  if (!sent.ok) return { ok: false, error: sent.error ?? "WhatsApp send failed." };

  const { data: row, error } = await supabase
    .from("thread_messages")
    .insert({
      message_id: `msg_out_${randomUUID()}`,
      thread_id: threadId,
      store_slug: thread.store_slug,
      customer_phone: thread.customer_phone,
      direction: "outbound",
      sender: actor,
      text: body,
      kind: "message",
    })
    .select(MSG_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };

  await supabase
    .from("threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("thread_id", threadId);
  revalidatePath("/conversations");
  return { ok: true, message: row as ConversationMessage };
}

export type RoutingResult =
  | { ok: true; routing_state: RoutingState }
  | { ok: false; error: string };

/**
 * Flip a thread's routing_state.
 *   idle -> active_owner_handling ("Start messaging"): the bot goes silent and
 *     the owner takes over; stamps activated_at/by.
 *   active_owner_handling -> idle ("Mark resolved"): hands the conversation back
 *     to the bot; stamps resolved_at/by.
 *
 * Runs as the user (RLS: any staff of the store may update its threads — taking
 * over a conversation is normal floor work, not owner-gated).
 *
 * Audit: besides the last-actor columns, every toggle appends a
 * routing_state_changed event to thread_messages (actor, from→to) so the thread
 * timeline shows the full takeover history inline.
 */
export async function setRouting(
  threadId: string,
  target: RoutingState,
): Promise<RoutingResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const actor = user?.email ?? user?.id ?? null;
  const now = new Date().toISOString();

  // Load current state + identity (for the event row + from→to).
  const { data: thread } = await supabase
    .from("threads")
    .select("store_slug, customer_phone, routing_state")
    .eq("thread_id", threadId)
    .maybeSingle();
  if (!thread) return { ok: false, error: "Thread not found." };

  const from = thread.routing_state;
  if (from === target) return { ok: true, routing_state: from }; // no-op

  const patch =
    target === "active_owner_handling"
      ? { routing_state: target, activated_at: now, activated_by: actor }
      : { routing_state: target, resolved_at: now, resolved_by: actor };

  const { data, error } = await supabase
    .from("threads")
    .update(patch)
    .eq("thread_id", threadId)
    .select("routing_state")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Thread not found." };

  // Append the routing_state_changed event (the thread already exists, so no
  // FK dance). Best-effort: the routing change is already committed + stamped.
  const verb = target === "active_owner_handling" ? "took over" : "resolved";
  await supabase.from("thread_messages").insert({
    message_id: `evt_${randomUUID()}`,
    thread_id: threadId,
    store_slug: thread.store_slug,
    customer_phone: thread.customer_phone,
    direction: "system",
    sender: actor,
    kind: "event",
    event_type: "routing_state_changed",
    text: `${actor ?? "Someone"} ${verb} the conversation`,
    event_payload_json: { from, to: target, by: actor },
  });

  revalidatePath("/conversations");
  return { ok: true, routing_state: data.routing_state };
}
