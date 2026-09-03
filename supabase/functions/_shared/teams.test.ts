// Teams core vetting — Bot Framework activity classification, identity/session, and
// the RS256 JWT verifier (against a generated keypair + JWKS, incl. attack cases).
//
//   deno test --allow-env supabase/functions/_shared/teams.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildTeamsRawIdentity, classifyActivity, teamsSessionId } from "./teams.ts";
import { verifyJwtRs256 } from "./teams-auth.ts";

// ── activity classification ──
const base = {
  type: "message",
  text: "hello rani",
  from: { id: "29:abc", name: "Ada", aadObjectId: "aad-1" },
  conversation: { id: "a:conv1" },
  serviceUrl: "https://smba.trafficmanager.net/amer/",
  channelData: { tenant: { id: "tenant-1" } },
  id: "act-1",
};

Deno.test("classify: a Teams message is answered + fields extracted", () => {
  const c = classifyActivity(base);
  assertEquals(c.act, true);
  assertEquals(c.event?.text, "hello rani");
  assertEquals(c.event?.aadObjectId, "aad-1");
  assertEquals(c.event?.tenantId, "tenant-1");
  assertEquals(c.event?.conversationId, "a:conv1");
  assertEquals(c.event?.activityId, "act-1");
});

Deno.test("classify: @mention chips are stripped from text", () => {
  const c = classifyActivity({ ...base, text: "<at>Rani</at> what's my plan?" });
  assertEquals(c.event?.text, "what's my plan?");
});

Deno.test("classify: non-message activities are ignored", () => {
  assertEquals(classifyActivity({ ...base, type: "conversationUpdate" }).act, false);
  assertEquals(classifyActivity({ ...base, text: "  " }).act, false);
  assertEquals(classifyActivity({ ...base, serviceUrl: "" }).act, false);
  assertEquals(classifyActivity(null).act, false);
});

Deno.test("session + identity", () => {
  assertEquals(teamsSessionId("tenant-1", "aad-1", "29:abc"), "teams_tenant-1_aad-1");
  assertEquals(teamsSessionId("tenant-1", "", "29:abc"), "teams_tenant-1_29:abc"); // falls back to from.id
  const r = buildTeamsRawIdentity("aad-1", "29:abc", "Ada", "ada@corp.test");
  assertEquals(r.email, "ada@corp.test");
  assertEquals(r.sub, "aad-1");
});

// ── Bot Framework JWT verification (RS256 against a JWKS) ──
const APP_ID = "bot-app-123";
const ISSUER = "https://api.botframework.com";
const KID = "bf-key-1";

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return b64url(bin);
}

const rsa = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
// deno-lint-ignore no-explicit-any
const pubJwk: any = await crypto.subtle.exportKey("jwk", rsa.publicKey);
pubJwk.kid = KID;
const JWKS = { keys: [pubJwk] };

async function sign(payload: Record<string, unknown>, alg = "RS256"): Promise<string> {
  const h = b64url(JSON.stringify({ alg, kid: KID, typ: "JWT" }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, rsa.privateKey, new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource);
  return `${h}.${p}.${b64urlBytes(new Uint8Array(sig))}`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const opts = { issuer: ISSUER, audience: APP_ID };

Deno.test("BF token: valid RS256 verifies to claims", async () => {
  const jwt = await sign({ iss: ISSUER, aud: APP_ID, exp: future, serviceurl: base.serviceUrl });
  const claims = await verifyJwtRs256(jwt, JWKS, opts);
  assertEquals(claims?.aud, APP_ID);
});

Deno.test("BF token: wrong audience is rejected", async () => {
  const jwt = await sign({ iss: ISSUER, aud: "someone-else", exp: future });
  assertEquals(await verifyJwtRs256(jwt, JWKS, opts), null);
});

Deno.test("BF token: wrong issuer is rejected", async () => {
  const jwt = await sign({ iss: "https://evil.test", aud: APP_ID, exp: future });
  assertEquals(await verifyJwtRs256(jwt, JWKS, opts), null);
});

Deno.test("BF token: expired (beyond skew) is rejected", async () => {
  const jwt = await sign({ iss: ISSUER, aud: APP_ID, exp: Math.floor(Date.now() / 1000) - 600 });
  assertEquals(await verifyJwtRs256(jwt, JWKS, opts), null);
});

Deno.test("BF token: alg:none and HS256 are rejected", async () => {
  const h = b64url(JSON.stringify({ alg: "none", kid: KID }));
  const p = b64url(JSON.stringify({ iss: ISSUER, aud: APP_ID, exp: future }));
  assertEquals(await verifyJwtRs256(`${h}.${p}.`, JWKS, opts), null);
  const h2 = b64url(JSON.stringify({ alg: "HS256", kid: KID }));
  assertEquals(await verifyJwtRs256(`${h2}.${p}.ZmFrZQ`, JWKS, opts), null);
});
