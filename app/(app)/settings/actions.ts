"use server";

import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

/** Owner of the store OR a platform admin may change its settings. */
async function requireStoreAccess(storeId: string) {
  const ctx = await getSessionContext();
  const allowed =
    !!ctx && (ctx.isPlatformAdmin || ctx.stores.some((s) => s.id === storeId && s.role === "owner"));
  if (!allowed) throw new Error("Not authorized");
}

/** Set the store's business type — which drives the console profile (SaaS vs
 *  local) and vocabulary. Only updates stores.business_type; it never re-seeds
 *  the agent config, so a store's tuned assistant is left untouched. */
export async function setConsoleType(
  storeId: string,
  businessType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const value = businessType.trim().toLowerCase();
  const db = createAdminClient();
  const { error } = await db
    .from("stores")
    .update({ business_type: value || null })
    .eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
