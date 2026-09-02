// End-to-end verification of the JWKS (bring-your-own-JWT) embed-SSO path.
// We generate a real RSA keypair, publish its public JWK as a JWKS (via a mocked
// fetch), sign genuine JWTs, and run them through the ACTUAL verifyEmbedIdentity —
// asserting the happy path plus the attack cases (alg:none, HS256 confusion,
// expired, wrong issuer, tampered signature). Also checks the 2-part HMAC path
// still works (backward compatibility).
//
//   deno test --allow-env --allow-net supabase/functions/_shared/members.jwks.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyEmbedIdentity } from "./members.ts";

const JWKS_URL = "https://issuer.example.test/.well-known/jwks.json";
const ISSUER = "https://issuer.example.test/";
const KID = "test-key-1";

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return b64url(bin);
}

// One RSA keypair for the whole suite; publish its public JWK as the JWKS.
const rsa = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
// deno-lint-ignore no-explicit-any
const pubJwk: any = await crypto.subtle.exportKey("jwk", rsa.publicKey);
pubJwk.kid = KID;
pubJwk.use = "sig";
pubJwk.alg = "RS256";
const JWKS = { keys: [pubJwk] };

// Mock fetch so the verifier's JWKS lookup returns our public key (no real net).
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  if (String(input) === JWKS_URL) {
    return Promise.resolve(new Response(JSON.stringify(JWKS), { status: 200, headers: { "content-type": "application/json" } }));
  }
  return realFetch(input as string);
  // deno-lint-ignore no-explicit-any
}) as any;

async function signRs256(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: KID, typ: "JWT" }): Promise<string> {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, rsa.privateKey, data as unknown as BufferSource);
  return `${h}.${p}.${b64urlBytes(new Uint8Array(sig))}`;
}

const cfg = { jwksUrl: JWKS_URL, issuer: ISSUER, emailClaim: "email", nameClaim: "name" };
const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 60;

Deno.test("JWKS: valid RS256 token → verified claims", async () => {
  const jwt = await signRs256({ email: "ada@corp.test", name: "Ada", sub: "user-42", iss: ISSUER, exp: future });
  const claim = await verifyEmbedIdentity(cfg, jwt);
  assertEquals(claim?.email, "ada@corp.test");
  assertEquals(claim?.name, "Ada");
  assertEquals(claim?.metadata?.sub, "user-42");
});

Deno.test("JWKS: custom email claim is honored", async () => {
  const jwt = await signRs256({ user_email: "grace@corp.test", iss: ISSUER, exp: future });
  const claim = await verifyEmbedIdentity({ ...cfg, emailClaim: "user_email" }, jwt);
  assertEquals(claim?.email, "grace@corp.test");
});

Deno.test("JWKS: expired token → null", async () => {
  const jwt = await signRs256({ email: "ada@corp.test", iss: ISSUER, exp: past });
  assertEquals(await verifyEmbedIdentity(cfg, jwt), null);
});

Deno.test("JWKS: wrong issuer → null", async () => {
  const jwt = await signRs256({ email: "ada@corp.test", iss: "https://evil.test/", exp: future });
  assertEquals(await verifyEmbedIdentity(cfg, jwt), null);
});

Deno.test("JWKS: alg:none is rejected → null", async () => {
  const h = b64url(JSON.stringify({ alg: "none", kid: KID }));
  const p = b64url(JSON.stringify({ email: "ada@corp.test", iss: ISSUER, exp: future }));
  assertEquals(await verifyEmbedIdentity(cfg, `${h}.${p}.`), null);
});

Deno.test("JWKS: HS256 confusion (symmetric alg) is rejected → null", async () => {
  // Attacker signs with HS256 using the public key as the secret — must be refused.
  const h = b64url(JSON.stringify({ alg: "HS256", kid: KID }));
  const p = b64url(JSON.stringify({ email: "ada@corp.test", iss: ISSUER, exp: future }));
  assertEquals(await verifyEmbedIdentity(cfg, `${h}.${p}.ZmFrZXNpZw`), null);
});

Deno.test("JWKS: tampered payload → null", async () => {
  const jwt = await signRs256({ email: "ada@corp.test", iss: ISSUER, exp: future });
  const [h, _p, s] = jwt.split(".");
  const forged = b64url(JSON.stringify({ email: "attacker@corp.test", iss: ISSUER, exp: future }));
  assertEquals(await verifyEmbedIdentity(cfg, `${h}.${forged}.${s}`), null);
});

Deno.test("JWKS: no email claim → null", async () => {
  const jwt = await signRs256({ sub: "no-email", iss: ISSUER, exp: future });
  assertEquals(await verifyEmbedIdentity(cfg, jwt), null);
});

Deno.test("HMAC path still works (2-part token, backward compat)", async () => {
  const secret = "sso_test_secret_value";
  const payload = b64url(JSON.stringify({ email: "leg@corp.test", exp: future }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload) as unknown as BufferSource);
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const claim = await verifyEmbedIdentity({ secret }, `${payload}.${hex}`);
  assertEquals(claim?.email, "leg@corp.test");
});
