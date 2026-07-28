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
  if (!c.access_token) return null;
  return {
    access_token: c.access_token,
    refresh_token: c.refresh_token ?? null,
    expires_at: c.expires_at ?? null,
    merchant_id: c.merchant_id ?? null,
    location_id: c.location_id ?? null,
    location_name: c.location_name ?? null,
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
 * A usable access token, refreshing via the adapter if expired or within 3 days
 * of expiry. Persists the rotated token. Throws if not connected.
 */
export async function getValidAccessToken(
  provider: PosProviderId,
  storeId: string,
): Promise<{ accessToken: string; creds: PosCreds }> {
  const creds = await getPosCreds(provider, storeId);
  if (!creds) throw new Error(`${provider} is not connected for this store.`);
  const adapter = getAdapter(provider);
  if (!adapter) throw new Error(`Unknown POS provider: ${provider}`);

  const soon = Date.now() + 3 * 24 * 60 * 60 * 1000;
  const expMs = creds.expires_at ? Date.parse(creds.expires_at) : 0;
  if (!creds.refresh_token || (expMs && expMs > soon)) {
    return { accessToken: creds.access_token, creds };
  }

  const refreshed = await adapter.refresh(creds.refresh_token);
  const next: PosCreds = {
    ...creds,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || creds.refresh_token,
    expires_at: refreshed.expires_at ?? null,
    merchant_id: refreshed.merchant_id ?? creds.merchant_id,
  };
  await savePosCreds(provider, storeId, next);
  return { accessToken: next.access_token, creds: next };
}
