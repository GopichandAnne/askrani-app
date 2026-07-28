import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PosCreds, PosProviderId } from "./types";
import { getAdapter } from "./registry";

/**
 * Per-store POS OAuth state in store_provider_credentials, keyed by provider,
 * plaintext-behind-RLS (same as Stripe keys — no column encryption exists).
 */
export async function getPosCreds(provider: PosProviderId, storeId: string): Promise<PosCreds | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("store_provider_credentials")
    .select("credentials, connected")
    .eq("store_id", storeId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data?.connected) return null;
  const c = (data.credentials ?? {}) as Partial<PosCreds>;
  // OAuth providers store an access_token; manual providers (Toast) may store
  // only a merchant/restaurant id — either counts as connected.
  if (!c.access_token && !c.merchant_id) return null;
  return {
    access_token: c.access_token ?? "",
    refresh_token: c.refresh_token ?? null,
    expires_at: c.expires_at ?? null,
    merchant_id: c.merchant_id ?? null,
    location_id: c.location_id ?? null,
    location_name: c.location_name ?? null,
    extra: c.extra ?? null,
  };
}

export async function savePosCreds(provider: PosProviderId, storeId: string, creds: PosCreds): Promise<void> {
  const db = createAdminClient();
  await db.from("store_provider_credentials").upsert(
    { store_id: storeId, provider, credentials: creds, connected: true },
    { onConflict: "store_id,provider" },
  );
}

export async function patchPosCreds(
  provider: PosProviderId,
  storeId: string,
  patch: Partial<PosCreds>,
): Promise<void> {
  const cur = await getPosCreds(provider, storeId);
  if (!cur) return;
  await savePosCreds(provider, storeId, { ...cur, ...patch });
}

export async function disconnectPos(provider: PosProviderId, storeId: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("store_provider_credentials")
    .update({ credentials: {}, connected: false })
    .eq("store_id", storeId)
    .eq("provider", provider);
}

/**
 * A usable access token for a connected provider. Token acquisition is owned by
 * the adapter (OAuth refresh, or a client-credentials login for Toast); any
 * rotated creds it returns are persisted here. Throws if not connected.
 */
export async function getValidAccessToken(
  provider: PosProviderId,
  storeId: string,
): Promise<{ accessToken: string; creds: PosCreds }> {
  const creds = await getPosCreds(provider, storeId);
  if (!creds) throw new Error(`${provider} is not connected for this store.`);
  const adapter = getAdapter(provider);
  if (!adapter) throw new Error(`Unknown POS provider: ${provider}`);

  const { accessToken, nextCreds } = await adapter.resolveAccessToken(creds);
  if (nextCreds) {
    await savePosCreds(provider, storeId, nextCreds);
    return { accessToken, creds: nextCreds };
  }
  return { accessToken, creds };
}
