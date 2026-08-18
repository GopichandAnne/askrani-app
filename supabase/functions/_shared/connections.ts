// The OAuth broker — connect a store to third-party providers (Google, Square,
// HubSpot, …) so Rani can act in their systems. This module holds the provider
// CATALOG, the signed-state helpers, AES-GCM token encryption, the code→token and
// refresh exchanges, and the token vault (oauth_connection).
//
// Security spine:
//   • The model NEVER sees a credential. This runs server-side (service role).
//   • Tokens are AES-GCM encrypted at rest with OAUTH_ENC_KEY.
//   • The OAuth `state` is HMAC-signed with OAUTH_STATE_SECRET (store_id + provider
//     + short expiry) so the callback can't be forged.
//   • Client id/secret per provider live in env (owner registers the app once).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ProviderId = "google" | "square" | "hubspot";

interface ProviderSpec {
  id: ProviderId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;                       // space-separated scopes we request
  scopeSep: string;                    // how the provider joins scopes in the URL
  authParams: Record<string, string>;  // extra authorize params (e.g. Google offline access)
  tokenStyle: "form" | "json";         // token endpoint body encoding
  test: { url: string; label: (j: Record<string, unknown>) => string | null };
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  google: {
    id: "google", label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/calendar.events",
    scopeSep: " ",
    authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    tokenStyle: "form",
    test: { url: "https://www.googleapis.com/oauth2/v3/userinfo", label: (j) => (typeof j.email === "string" ? j.email : null) },
  },
  square: {
    id: "square", label: "Square",
    authorizeUrl: "https://connect.squareup.com/oauth2/authorize",
    tokenUrl: "https://connect.squareup.com/oauth2/token",
    scope: "MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ",
    scopeSep: "+",
    authParams: { session: "false" },
    tokenStyle: "json",
    test: {
      url: "https://connect.squareup.com/v2/merchants",
      label: (j) => {
        const m = (j.merchant as { business_name?: string }[] | undefined)?.[0];
        return m?.business_name ?? null;
      },
    },
  },
  hubspot: {
    id: "hubspot", label: "HubSpot",
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scope: "oauth crm.objects.contacts.read",
    scopeSep: " ",
    authParams: {},
    tokenStyle: "form",
    test: { url: "https://api.hubapi.com/account-info/v3/details", label: (j) => (j.portalId != null ? `Portal ${j.portalId}` : null) },
  },
};

export function isProvider(x: string): x is ProviderId {
  return x === "google" || x === "square" || x === "hubspot";
}

/** The owner-registered app credentials for a provider (env). Null if unset. */
export function providerClient(id: ProviderId): { clientId: string; clientSecret: string } | null {
  const clientId = Deno.env.get(`OAUTH_${id.toUpperCase()}_CLIENT_ID`) ?? "";
  const clientSecret = Deno.env.get(`OAUTH_${id.toUpperCase()}_CLIENT_SECRET`) ?? "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The exact redirect URI registered with every provider. */
export function redirectUri(): string {
  const explicit = Deno.env.get("OAUTH_CALLBACK_URL");
  if (explicit) return explicit;
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/oauth-callback`;
}

/** Where to send the owner's browser back to after the flow (the panel). */
export function panelUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://app.askrani.ai").replace(/\/$/, "");
}

/* ── base64 / hex helpers ──────────────────────────────────────────────────── */
function bytesToBase64(b: Uint8Array): string { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }
function base64ToBytes(s: string): Uint8Array { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function b64url(b: Uint8Array): string { return bytesToBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function fromB64url(s: string): Uint8Array { const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : ""; return base64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/") + pad); }
function hexToBytes(h: string): Uint8Array { const out = new Uint8Array(h.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; }
/** Copy bytes into a standalone ArrayBuffer (WebCrypto wants ArrayBuffer-backed BufferSource). */
function bs(u: Uint8Array): ArrayBuffer { const a = new ArrayBuffer(u.byteLength); new Uint8Array(a).set(u); return a; }
function utf8(s: string): ArrayBuffer { return bs(new TextEncoder().encode(s)); }

/* ── signed state (HMAC) ───────────────────────────────────────────────────── */
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function hmac(secret: string, msg: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(msg));
  return b64url(new Uint8Array(mac));
}
function timingEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
export interface StateObj { sid: string; prov: ProviderId; uid: string; exp: number; n: string }
export async function signState(obj: StateObj): Promise<string> {
  const secret = Deno.env.get("OAUTH_STATE_SECRET");
  if (!secret) throw new Error("OAUTH_STATE_SECRET not set");
  const payload = b64url(new TextEncoder().encode(JSON.stringify(obj)));
  return `${payload}.${await hmac(secret, payload)}`;
}
export async function verifyState(state: string): Promise<StateObj | null> {
  try {
    const secret = Deno.env.get("OAUTH_STATE_SECRET");
    if (!secret) return null;
    const [payload, sig] = state.split(".");
    if (!payload || !sig) return null;
    if (!timingEq(sig, await hmac(secret, payload))) return null;
    const obj = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as StateObj;
    if (!obj || typeof obj.exp !== "number" || obj.exp < Math.floor(Date.now() / 1000)) return null;
    if (!isProvider(obj.prov)) return null;
    return obj;
  } catch { return null; }
}

/* ── token encryption (AES-GCM) ────────────────────────────────────────────── */
async function encKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("OAUTH_ENC_KEY") ?? "";
  if (!raw) return null;
  const bytes = /^[0-9a-f]{64}$/i.test(raw) ? hexToBytes(raw) : base64ToBytes(raw);
  if (bytes.length !== 32) return null;
  return crypto.subtle.importKey("raw", bs(bytes), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encrypt(text: string): Promise<string> {
  const key = await encKey();
  if (!key) throw new Error("OAUTH_ENC_KEY missing or not 32 bytes");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, utf8(text)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return bytesToBase64(out);
}
async function decrypt(b64: string): Promise<string> {
  const key = await encKey();
  if (!key) throw new Error("OAUTH_ENC_KEY missing or not 32 bytes");
  const all = base64ToBytes(b64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(all.slice(0, 12)) }, key, bs(all.slice(12)));
  return new TextDecoder().decode(pt);
}

/* ── authorize URL + token exchanges ───────────────────────────────────────── */
export function buildAuthorizeUrl(id: ProviderId, clientId: string, state: string): string {
  const p = PROVIDERS[id];
  const u = new URL(p.authorizeUrl);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(p.authParams)) u.searchParams.set(k, v);
  // scope is joined the provider's way (Square wants '+', which URLSearchParams
  // would double-encode) — append it manually.
  const scope = p.scope.split(" ").join(p.scopeSep);
  const sep = u.search ? "&" : "?";
  return `${u.toString()}${sep}scope=${encodeURIComponent(scope).replace(/%2B/g, "+")}`;
}

export interface RawTokens { access_token?: string; refresh_token?: string; expires_in?: number; expires_at?: string }
export interface Tokens { accessToken: string; refreshToken: string | null; expiresAt: string | null; scope: string | null }

async function callToken(id: ProviderId, body: Record<string, string>): Promise<RawTokens> {
  const p = PROVIDERS[id];
  const init: RequestInit = p.tokenStyle === "json"
    ? { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }
    : { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body).toString() };
  const res = await fetch(p.tokenUrl, init);
  const txt = await res.text();
  if (!res.ok) throw new Error(`token ${res.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt) as RawTokens;
}

function normalize(raw: RawTokens, scope: string | null): Tokens {
  let expiresAt: string | null = null;
  if (raw.expires_at) expiresAt = new Date(raw.expires_at).toISOString();
  else if (typeof raw.expires_in === "number") expiresAt = new Date(Date.now() + raw.expires_in * 1000).toISOString();
  return { accessToken: String(raw.access_token ?? ""), refreshToken: raw.refresh_token ?? null, expiresAt, scope };
}

export async function exchangeCode(id: ProviderId, code: string, clientId: string, clientSecret: string): Promise<Tokens> {
  const raw = await callToken(id, {
    grant_type: "authorization_code", code, redirect_uri: redirectUri(),
    client_id: clientId, client_secret: clientSecret,
  });
  return normalize(raw, PROVIDERS[id].scope);
}
async function refreshToken(id: ProviderId, refresh: string, clientId: string, clientSecret: string): Promise<Tokens> {
  const raw = await callToken(id, { grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, client_secret: clientSecret });
  // Some providers don't re-issue a refresh token on refresh — keep the old one.
  const t = normalize(raw, null);
  if (!t.refreshToken) t.refreshToken = refresh;
  return t;
}

/** Verify a fresh access token against the provider and return a human label. */
export async function testCall(id: ProviderId, accessToken: string): Promise<{ ok: boolean; label: string | null }> {
  try {
    const res = await fetch(PROVIDERS[id].test.url, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
    if (!res.ok) return { ok: false, label: null };
    const j = await res.json();
    return { ok: true, label: PROVIDERS[id].test.label(j) };
  } catch { return { ok: false, label: null }; }
}

/* ── the vault ─────────────────────────────────────────────────────────────── */
export async function saveConnection(
  db: SupabaseClient, storeId: string, id: ProviderId, tokens: Tokens, label: string | null, connectedBy: string | null,
): Promise<void> {
  const row = {
    store_id: storeId, provider: id,
    access_token: await encrypt(tokens.accessToken),
    refresh_token: tokens.refreshToken ? await encrypt(tokens.refreshToken) : null,
    expires_at: tokens.expiresAt, scope: tokens.scope, account_label: label,
    status: "connected", connected_by: connectedBy, updated_at: new Date().toISOString(),
  };
  await db.from("oauth_connection").upsert(row, { onConflict: "store_id,provider" });
}

interface ConnRow { access_token: string; refresh_token: string | null; expires_at: string | null; scope: string | null; account_label: string | null; status: string }

/** A fresh, decrypted access token for a store+provider — refreshing if expired.
 *  Returns null when not connected or a refresh fails. Never throws. */
export async function getAccessToken(db: SupabaseClient, storeId: string, id: ProviderId): Promise<string | null> {
  try {
    const { data } = await db.from("oauth_connection")
      .select("access_token, refresh_token, expires_at, scope, account_label, status")
      .eq("store_id", storeId).eq("provider", id).maybeSingle();
    const row = data as ConnRow | null;
    if (!row || row.status !== "connected") return null;

    const expSoon = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() + 60_000 : false;
    if (!expSoon) return await decrypt(row.access_token);

    // Expired (or about to) → refresh.
    if (!row.refresh_token) return await decrypt(row.access_token); // no refresh token; hand back what we have
    const client = providerClient(id);
    if (!client) return null;
    const refreshed = await refreshToken(id, await decrypt(row.refresh_token), client.clientId, client.clientSecret);
    await saveConnection(db, storeId, id, refreshed, row.account_label, null);
    return refreshed.accessToken;
  } catch (e) {
    console.error(`[connections] getAccessToken ${id}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export async function disconnect(db: SupabaseClient, storeId: string, id: ProviderId): Promise<void> {
  await db.from("oauth_connection").delete().eq("store_id", storeId).eq("provider", id);
}

/** Which providers a store has connected — so the bot only offers the matching
 *  tools (e.g. calendar tools only when Google is connected). */
export async function listConnectedProviders(db: SupabaseClient, storeId: string): Promise<string[]> {
  const { data } = await db.from("oauth_connection").select("provider").eq("store_id", storeId).eq("status", "connected");
  return (data ?? []).map((r: { provider: string }) => r.provider);
}
