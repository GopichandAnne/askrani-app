import "server-only";
import { squareConfig, type SquareConfig, SQUARE_SCOPES, SQUARE_VERSION } from "./config";

/** Build the Square authorize URL the owner is redirected to. `state` is a signed
 *  nonce we verify on callback (CSRF + which store is connecting). */
export function buildAuthorizeUrl(cfg: SquareConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.appId,
    scope: SQUARE_SCOPES.join(" "),
    session: "false",
    state,
  });
  return `${cfg.connectBase}/oauth2/authorize?${p.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: string | null;
  merchant_id: string | null;
};

async function tokenRequest(cfg: SquareConfig, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${cfg.connectBase}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
    body: JSON.stringify({ client_id: cfg.appId, client_secret: cfg.appSecret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (json?.errors as { detail?: string }[] | undefined)?.[0]?.detail;
    throw new Error(`Square token error (${res.status}): ${detail ?? "unknown"}`);
  }
  return {
    access_token: String(json.access_token ?? ""),
    refresh_token: String(json.refresh_token ?? ""),
    expires_at: json.expires_at ? String(json.expires_at) : null,
    merchant_id: json.merchant_id ? String(json.merchant_id) : null,
  };
}

/** Exchange the authorization code for tokens (called on the OAuth callback). */
export function exchangeCode(cfg: SquareConfig, code: string): Promise<TokenResponse> {
  return tokenRequest(cfg, {
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUrl,
  });
}

/** Refresh an access token using the stored refresh token. */
export function refreshAccessToken(cfg: SquareConfig, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken });
}

export type SquareLocation = { id: string; name: string; status: string };

/** List the merchant's Square locations so the owner can pick where orders route. */
export async function listLocations(accessToken: string): Promise<SquareLocation[]> {
  const cfg = squareConfig();
  const res = await fetch(`${cfg.apiBase}/v2/locations`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": SQUARE_VERSION },
  });
  const json = (await res.json().catch(() => ({}))) as { locations?: { id: string; name: string; status: string }[] };
  if (!res.ok) return [];
  return (json.locations ?? []).map((l) => ({ id: l.id, name: l.name, status: l.status }));
}
