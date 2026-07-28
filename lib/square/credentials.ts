import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { squareConfig } from "./config";
import { refreshAccessToken } from "./oauth";

/**
 * Per-store Square OAuth state, stored as plaintext jsonb in
 * store_provider_credentials (provider='square'), behind service-role RLS — the
 * same posture as Stripe keys. No column encryption exists in this project.
 */
export type SquareCreds = {
  access_token: string;
  refresh_token: string;
  expires_at: string | null; // ISO; Square access tokens last ~30 days
  merchant_id: string | null;
  location_id: string | null; // the chosen Square location to route orders to
  location_name?: string | null;
};

const PROVIDER = "square";

export async function getSquareCreds(storeId: string): Promise<SquareCreds | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("store_provider_credentials")
    .select("credentials, connected")
    .eq("store_id", storeId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (!data?.connected) return null;
  const c = (data.credentials ?? {}) as Partial<SquareCreds>;
  if (!c.access_token || !c.refresh_token) return null;
  return {
    access_token: c.access_token,
    refresh_token: c.refresh_token,
    expires_at: c.expires_at ?? null,
    merchant_id: c.merchant_id ?? null,
    location_id: c.location_id ?? null,
    location_name: c.location_name ?? null,
  };
}

export async function saveSquareCreds(storeId: string, creds: SquareCreds): Promise<void> {
  const db = createAdminClient();
  await db.from("store_provider_credentials").upsert(
    { store_id: storeId, provider: PROVIDER, credentials: creds, connected: true },
    { onConflict: "store_id,provider" },
  );
}

/** Merge a partial update (e.g. the chosen location) onto stored creds. */
export async function patchSquareCreds(storeId: string, patch: Partial<SquareCreds>): Promise<void> {
  const cur = await getSquareCreds(storeId);
  if (!cur) return;
  await saveSquareCreds(storeId, { ...cur, ...patch });
}

export async function disconnectSquare(storeId: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("store_provider_credentials")
    .update({ credentials: {}, connected: false })
    .eq("store_id", storeId)
    .eq("provider", PROVIDER);
}

/**
 * Return a usable access token, refreshing if it's expired or within 3 days of
 * expiry. Persists the rotated token. Throws if the store isn't connected.
 */
export async function getValidAccessToken(storeId: string): Promise<{ accessToken: string; creds: SquareCreds }> {
  const creds = await getSquareCreds(storeId);
  if (!creds) throw new Error("Square is not connected for this store.");
  const soon = Date.now() + 3 * 24 * 60 * 60 * 1000;
  const expMs = creds.expires_at ? Date.parse(creds.expires_at) : 0;
  if (expMs && expMs > soon) return { accessToken: creds.access_token, creds };

  // Expired or near-expiry → refresh.
  const cfg = squareConfig();
  const refreshed = await refreshAccessToken(cfg, creds.refresh_token);
  const next: SquareCreds = {
    ...creds,
    access_token: refreshed.access_token,
    // Square may or may not rotate the refresh token; keep the old one if absent.
    refresh_token: refreshed.refresh_token || creds.refresh_token,
    expires_at: refreshed.expires_at ?? null,
    merchant_id: refreshed.merchant_id ?? creds.merchant_id,
  };
  await saveSquareCreds(storeId, next);
  return { accessToken: next.access_token, creds: next };
}
