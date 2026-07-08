"use server";

import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export type LinkResult =
  | { ok: true; token: string; active: boolean }
  | { ok: false; error: string };

/** Owner of the store OR a platform admin may manage its link. */
async function requireStoreAccess(storeId: string) {
  const ctx = await getSessionContext();
  const allowed =
    !!ctx &&
    (ctx.isPlatformAdmin || ctx.stores.some((s) => s.id === storeId && s.role === "owner"));
  if (!allowed) throw new Error("Not authorized");
}

function newToken(): string {
  return "tok_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** Current link token for a store (latest); creates one if none exists yet. */
export async function getStoreLink(storeId: string): Promise<LinkResult> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();

  const { data: existing } = await db
    .from("store_tokens")
    .select("token, active")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    return { ok: true, token: existing[0].token, active: existing[0].active };
  }

  const token = newToken();
  const { error } = await db
    .from("store_tokens")
    .insert({ store_id: storeId, token, label: "primary QR", active: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token, active: true };
}

/** Enable / disable the store's current link token. */
export async function setLinkActive(storeId: string, active: boolean): Promise<LinkResult> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();

  const { data: existing } = await db
    .from("store_tokens")
    .select("id, token")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!existing || existing.length === 0) return { ok: false, error: "No link to update." };

  const { error } = await db.from("store_tokens").update({ active }).eq("id", existing[0].id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, token: existing[0].token, active };
}

/** Issue a fresh link and retire all previous tokens (use if a QR leaks). */
export async function regenerateLink(storeId: string): Promise<LinkResult> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();

  await db.from("store_tokens").update({ active: false }).eq("store_id", storeId).eq("active", true);
  const token = newToken();
  const { error } = await db
    .from("store_tokens")
    .insert({ store_id: storeId, token, label: "primary QR", active: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token, active: true };
}
