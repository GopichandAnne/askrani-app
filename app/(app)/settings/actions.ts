"use server";

import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

/** Changing the console type / vertical is restricted to Ask Rani (platform
 *  admins) only — store owners can view it but not switch it. */
async function requirePlatformAdmin() {
  const ctx = await getSessionContext();
  return !!ctx?.isPlatformAdmin;
}

/** Set the store's business type — which drives the console profile (SaaS vs
 *  local) and vocabulary. Only updates stores.business_type; it never re-seeds
 *  the agent config, so a store's tuned assistant is left untouched. */
export async function setConsoleType(
  storeId: string,
  businessType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: "Only Ask Rani can change the console type." };
  }
  const value = businessType.trim().toLowerCase();
  const db = createAdminClient();
  const { error } = await db
    .from("stores")
    .update({ business_type: value || null })
    .eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
