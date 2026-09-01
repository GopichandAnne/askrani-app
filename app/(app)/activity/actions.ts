"use server";

import { getActiveStore } from "@/lib/store/active-store";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolve a held action request — the owner-side of the hold → ticket → notify
 * loop. Marks the pending request approved or declined and records who decided.
 *
 * v1 records the DECISION; it does not re-run the held tool. Approving is the
 * owner's sign-off — the write is then completed in their system (the same manual
 * step "a person approves" has always meant). This keeps a held action from ever
 * executing without an explicit human in the loop.
 */
export async function decideActionRequest(
  id: string,
  decision: "approved" | "declined",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "Not signed in." };
  const isOwner = ctx.isPlatformAdmin || ctx.active.role === "owner";
  if (!isOwner) return { ok: false, error: "Only an owner can resolve approvals." };

  const db = createAdminClient();
  // Scope the update to THIS store + still-pending, so a stale click can't flip a
  // request that belongs to another store or was already decided.
  const { data, error } = await db
    .from("action_request")
    .update({
      status: decision,
      decided_by: ctx.user.email ?? "an owner",
      decided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("store_id", ctx.active.id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Already resolved." };
  return { ok: true };
}
