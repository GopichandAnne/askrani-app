"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";

export type AnswerResult = { ok: true } | { ok: false; error: string };

/**
 * Answer an escalation ticket from the dashboard — works for anyone on the
 * store's team (owners and staff, including email-only responders who can't
 * reply over WhatsApp). Delivery is identical to a WhatsApp reply: the customer
 * gets the answer (WhatsApp or web/Realtime), the ticket is marked answered,
 * Rani learns from it, and the team is told it's handled.
 */
export async function answerTicket(ticketId: string, answer: string): Promise<AnswerResult> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const a = answer.trim();
  if (!a) return { ok: false, error: "Write an answer first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const by = user?.email || "Store team";

  const res = await callBotAdmin({
    action: "answer_ticket",
    store_slug: ctx.active.slug,
    ticket_id: ticketId,
    answer: a,
    by,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const data = res.data as { handled?: boolean; note?: string };
  if (!data.handled) {
    const msg =
      data.note === "already_answered"
        ? "That ticket was already answered (maybe over WhatsApp)."
        : data.note === "not_found"
          ? "Ticket not found."
          : "Couldn't send the answer.";
    return { ok: false, error: msg };
  }
  revalidatePath("/tickets");
  return { ok: true };
}
