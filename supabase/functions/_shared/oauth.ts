// Verify Apple/Google "one-tap" OpenID Connect ID tokens server-side. The diner
// gets a signed JWT from Google Identity Services / Sign in with Apple JS; we
// verify its RS256 signature against the provider's public JWKS and check
// iss / aud / exp before trusting the enclosed (verified) email. No client secret
// is needed for the ID-token flow — only the client id, checked as the audience.

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };
const jwksCache = new Map<string, { keys: Jwk[]; exp: number }>();

async function fetchJwks(url: string): Promise<Jwk[]> {
  const c = jwksCache.get(url);
  if (c && c.exp > Date.now()) return c.keys;
  const res = await fetch(url);
  if (!res.ok) return c?.keys ?? [];
  const j = await res.json();
  const keys: Jwk[] = Array.isArray(j.keys) ? j.keys : [];
  jwksCache.set(url, { keys, exp: Date.now() + 3600_000 }); // 1h cache
  return keys;
}

function b64urlBytes(s: string): ArrayBuffer {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const ab = new ArrayBuffer(b.length);
  const out = new Uint8Array(ab);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return ab;
}
function b64urlJson(s: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
}

export type OidcClaim = { sub: string; email: string | null; emailVerified: boolean; name: string | null };

/** Verify an OIDC ID token (RS256). Returns the claims, or null on ANY doubt. */
export async function verifyOidcIdToken(
  idToken: string,
  opts: { jwksUrl: string; issuers: string[]; audiences: string[]; nonce?: string | null },
): Promise<OidcClaim | null> {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const header = b64urlJson(parts[0]) as { alg?: string; kid?: string };
    const payload = b64urlJson(parts[1]) as Record<string, unknown>;

    if (header.alg !== "RS256" || !header.kid) return null;
    if (!opts.issuers.includes(String(payload.iss ?? ""))) return null;
    const aud = payload.aud;
    const auds = Array.isArray(aud) ? aud.map(String) : [String(aud ?? "")];
    if (!auds.some((a) => opts.audiences.includes(a))) return null;
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
    if (opts.nonce != null && String(payload.nonce ?? "") !== opts.nonce) return null;

    const keys = await fetchJwks(opts.jwksUrl);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signedAb = new ArrayBuffer(signed.byteLength);
    new Uint8Array(signedAb).set(signed);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), signedAb);
    if (!ok) return null;

    const ev = payload.email_verified;
    return {
      sub: String(payload.sub ?? ""),
      email: payload.email ? String(payload.email).toLowerCase() : null,
      emailVerified: ev === true || ev === "true",
      name: payload.name ? String(payload.name) : null,
    };
  } catch (e) {
    console.error(`[oauth] verify: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export function verifyGoogleIdToken(idToken: string, audiences: string[], nonce?: string | null) {
  return verifyOidcIdToken(idToken, {
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    audiences,
    nonce,
  });
}
export function verifyAppleIdToken(idToken: string, audiences: string[], nonce?: string | null) {
  return verifyOidcIdToken(idToken, {
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    audiences,
    nonce,
  });
}
