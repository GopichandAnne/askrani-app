"use server";

import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type TeamsStatus = { configured: boolean; connected: boolean; tenantId?: string | null };

async function requireOwner(storeId: string) {
  const ctx = await getActiveStore();
  if (!ctx?.active || ctx.active.id !== storeId) throw new Error("No access to this store.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: storeId });
  if (!isOwner) throw new Error("Owners only.");
}

export async function getTeamsStatus(storeId: string): Promise<TeamsStatus> {
  await requireOwner(storeId);
  const db = createAdminClient();
  // deno-lint-ignore no-explicit-any
  const from = db.from as unknown as (t: string) => any;
  const { data } = await from("teams_installs").select("tenant_id").eq("store_id", storeId).eq("active", true).maybeSingle();
  const configured = !!(process.env.MICROSOFT_APP_ID && process.env.MICROSOFT_APP_PASSWORD);
  return { configured, connected: !!data, tenantId: data?.tenant_id ?? null };
}

/** Map (or clear) an Azure AD tenant → this store, so Teams messages from that tenant
 *  route here. One bot serves many tenants; the tenant id is the org's directory id. */
export async function setTeamsTenant(storeId: string, tenantId: string): Promise<{ ok: boolean; error?: string }> {
  await requireOwner(storeId);
  const t = tenantId.trim();
  const db = createAdminClient();
  // deno-lint-ignore no-explicit-any
  const from = db.from as unknown as (t: string) => any;
  if (!t) {
    await from("teams_installs").update({ active: false }).eq("store_id", storeId);
    return { ok: true };
  }
  if (!/^[0-9a-fA-F-]{16,}$/.test(t)) return { ok: false, error: "That doesn't look like an Azure tenant id (a GUID)." };
  const { error } = await from("teams_installs").upsert({ tenant_id: t, store_id: storeId, active: true }, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
