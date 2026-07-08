"use server";

import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export type LinkResult =
  | { ok: true; token: string; active: boolean; paused: boolean }
  | { ok: false; error: string };

export type TokenResult =
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

  const [{ data: existing }, { data: store }] = await Promise.all([
    db
      .from("store_tokens")
      .select("token, active")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(1),
    db.from("stores").select("web_chat_paused").eq("id", storeId).single(),
  ]);
  const paused = !!store?.web_chat_paused;

  if (existing && existing.length > 0) {
    return { ok: true, token: existing[0].token, active: existing[0].active, paused };
  }

  const token = newToken();
  const { error } = await db
    .from("store_tokens")
    .insert({ store_id: storeId, token, label: "primary QR", active: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token, active: true, paused };
}

/** Put the store's web chat into (or out of) "Rani is taking a break" mode. */
export async function setWebChatPaused(
  storeId: string,
  paused: boolean,
): Promise<{ ok: true; paused: boolean } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const { error } = await db.from("stores").update({ web_chat_paused: paused }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, paused };
}

/** Enable / disable the store's current link token. */
export async function setLinkActive(storeId: string, active: boolean): Promise<TokenResult> {
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
export async function regenerateLink(storeId: string): Promise<TokenResult> {
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
