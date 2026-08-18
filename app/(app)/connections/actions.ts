"use server";

import { getActiveStore } from "@/lib/store/active-store";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Disconnect a connected provider — deletes the token row from the vault. Owner
 * only, scoped to the active store. (Provider-side revoke is a later enhancement;
 * removing our copy of the tokens stops all access from Rani.)
 */
export async function disconnectProvider(provider: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "You're not signed in." };
  if (ctx.active.role !== "owner") return { ok: false, error: "Only the store owner can change connections." };

  const db = createAdminClient();
  const { error } = await db.from("oauth_connection").delete().eq("store_id", ctx.active.id).eq("provider", provider);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
