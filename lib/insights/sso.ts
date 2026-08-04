import "server-only";
import crypto from "node:crypto";

/**
 * Host side of the Ask Rani → Insights SSO. When a platform admin has granted a
 * store `insights_enabled`, we mint a short-lived HS256 token (signed with the
 * shared INSIGHTS_SSO_SECRET) that the Insights app's /api/sso route verifies and
 * exchanges for a session — so an owner opens embedded Insights with no second
 * login. The token contract mirrors `verifyInboundToken` on the Insights side.
 *
 * Server-only (the signing key must never reach the client). Never NEXT_PUBLIC.
 */

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function isInsightsSsoConfigured(): boolean {
  return !!process.env.INSIGHTS_SSO_SECRET;
}

/** Base URL of the Insights (guest) app. */
export function insightsBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_INSIGHTS_URL || "https://insights.askrani.ai").replace(/\/$/, "");
}

/** Mint a token the Insights /api/sso route accepts. TTL is deliberately short —
 *  it's used immediately to establish the iframe session. */
export function mintInsightsToken(input: {
  email: string;
  sub?: string; // the Rani user id (stable linking)
  name?: string;
  storeName?: string; // shown as the org hint on the Insights side
}): string {
  const secret = process.env.INSIGHTS_SSO_SECRET;
  if (!secret) throw new Error("INSIGHTS_SSO_SECRET is not set");
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("mintInsightsToken: valid email required");

  const header = b64url({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url({
    iss: "askrani",
    aud: "insights",
    email,
    sub: input.sub,
    name: input.name,
    org: input.storeName,
    insights_access: true,
    iat: now,
    exp: now + 120,
  });
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}
