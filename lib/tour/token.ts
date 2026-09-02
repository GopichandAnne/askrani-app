import "server-only";
import crypto from "node:crypto";

// Mint/verify the embedded-SSO identity token for the product tour, in EXACTLY the
// format the chat engine's verifyIdentityToken (supabase/functions/_shared/members.ts)
// expects: base64url(JSON payload) + "." + hmacHex(identity_secret, payloadB64).
// Payload carries the signed-in visitor's email (required) + name + sub (our user id,
// which the edge verifier ignores but our tour API uses to load their real account).

export function mintTourToken(
  secret: string,
  claim: { email: string; name?: string; sub?: string; ttlSec?: number },
): string {
  const payload = {
    email: claim.email.trim().toLowerCase(),
    ...(claim.name ? { name: claim.name } : {}),
    ...(claim.sub ? { sub: claim.sub } : {}),
    exp: Math.floor(Date.now() / 1000) + (claim.ttlSec ?? 300),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
  return `${payloadB64}.${sig}`;
}

export type TourClaim = { email: string; name?: string; sub?: string };

/** Verify a token the tour API received (forwarded by identity-mode tool-calling). */
export function verifyTourToken(secret: string, token: string): TourClaim | null {
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (p.exp && Date.now() / 1000 > Number(p.exp)) return null;
    if (!p.email) return null;
    return {
      email: String(p.email),
      name: p.name ? String(p.name) : undefined,
      sub: p.sub ? String(p.sub) : undefined,
    };
  } catch {
    return null;
  }
}
