// Microsoft Teams / Bot Framework auth. Incoming activities carry a Bearer JWT signed
// by Bot Framework; we verify it against their published JWKS (issuer api.botframework.com,
// audience = our bot's app id). Outbound replies + the Graph email lookup use an app
// (client-credentials) token. The verify core is pure (JWKS passed in) so it's testable.

const RS: Record<string, string> = { RS256: "SHA-256", RS384: "SHA-384", RS512: "SHA-512" };

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToStr(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

/** Verify an RS* JWT against an already-fetched JWKS + issuer/audience. Pure (no
 *  network) so it can be unit-tested with a generated keypair. Returns the payload
 *  claims or null. */
export async function verifyJwtRs256(
  token: string,
  // deno-lint-ignore no-explicit-any
  jwks: { keys: any[] },
  opts: { issuer?: string | string[]; audience?: string },
  nowSec: number = Date.now() / 1000,
): Promise<Record<string, unknown> | null> {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const header = JSON.parse(b64urlToStr(h));
    const hash = RS[header.alg];
    if (!hash) return null; // RS* only — never HS*/none from JWKS
    const jwk = jwks.keys.find((k) => k.kid === header.kid) || (jwks.keys.length === 1 ? jwks.keys[0] : null);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      b64urlToBytes(s) as unknown as BufferSource,
      new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource,
    );
    if (!ok) return null;
    const payload = JSON.parse(b64urlToStr(p)) as Record<string, unknown>;
    if (payload.exp && nowSec > Number(payload.exp) + 300) return null; // 5-min clock skew
    if (payload.nbf && nowSec < Number(payload.nbf) - 300) return null;
    if (opts.issuer) {
      const allowed = Array.isArray(opts.issuer) ? opts.issuer : [opts.issuer];
      if (!allowed.includes(String(payload.iss))) return null;
    }
    if (opts.audience && String(payload.aud) !== opts.audience) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Network: JWKS + tokens + outbound ────────────────────────────────────────
const BF_OPENID = "https://login.botframework.com/v1/.well-known/openidconfiguration";
const BF_ISSUER = "https://api.botframework.com";
// deno-lint-ignore no-explicit-any
let jwksCache: { keys: any[]; exp: number } | null = null;

async function botFrameworkJwks(): Promise<{ keys: unknown[] }> {
  if (jwksCache && jwksCache.exp > Date.now()) return jwksCache;
  const cfg = await (await fetch(BF_OPENID)).json();
  const jwks = await (await fetch(cfg.jwks_uri)).json();
  jwksCache = { keys: jwks.keys ?? [], exp: Date.now() + 12 * 60 * 60 * 1000 }; // 12h
  return jwksCache;
}

/** Verify an incoming Bot Framework request token → its claims, or null. */
export async function verifyBotFrameworkToken(token: string, appId: string): Promise<Record<string, unknown> | null> {
  if (!token || !appId) return null;
  const jwks = await botFrameworkJwks();
  return await verifyJwtRs256(token, jwks as { keys: unknown[] } & { keys: unknown[] }, { issuer: BF_ISSUER, audience: appId });
}

/** Client-credentials token for a scope (outbound Bot Framework or Graph). */
async function appToken(appId: string, appPassword: string, scope: string, tenant = "botframework.com"): Promise<string | null> {
  try {
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: appId, client_secret: appPassword, scope });
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const j = await res.json();
    return j?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Post a text reply back to the conversation via the incoming activity's serviceUrl. */
export async function postTeamsReply(appId: string, appPassword: string, serviceUrl: string, conversationId: string, text: string): Promise<boolean> {
  const tok = await appToken(appId, appPassword, "https://api.botframework.com/.default");
  if (!tok) return false;
  try {
    const url = `${serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify({ type: "message", text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Best-effort email for a Teams user via Graph (needs User.Read.All app permission). */
export async function graphEmail(appId: string, appPassword: string, tenantId: string, aadObjectId: string): Promise<string | null> {
  if (!tenantId || !aadObjectId) return null;
  const tok = await appToken(appId, appPassword, "https://graph.microsoft.com/.default", tenantId);
  if (!tok) return null;
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(aadObjectId)}?$select=mail,userPrincipalName`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    const j = await res.json();
    return j?.mail ?? j?.userPrincipalName ?? null;
  } catch {
    return null;
  }
}
