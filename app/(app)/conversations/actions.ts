"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { RoutingState } from "@/lib/conversations/types";

export type RoutingResult =
  | { ok: true; routing_state: RoutingState }
  | { ok: false; error: string };

/**
 * Flip a thread's routing_state.
 *   idle -> active_owner_handling ("Start messaging"): the bot goes silent and
 *     the owner takes over; stamps activated_at/by.
 *   active_owner_handling -> idle ("Mark resolved"): hands the conversation back
 *     to the bot; stamps resolved_at/by.
 * Runs as the user (RLS: any staff of the store may update its threads).
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

  revalidatePath("/conversations");
  return { ok: true, routing_state: data.routing_state };
}
