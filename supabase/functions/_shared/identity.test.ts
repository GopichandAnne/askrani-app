// Organization-identity service: proves the non-breaking legacy fallback (a store
// with no provider rows uses its stores.sso_* columns), plus the new provider rows,
// the domain gate, and token→provider routing — all through the real code.
//
//   deno test --allow-env --allow-net supabase/functions/_shared/identity.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadProviders, pickConfigForToken, verifyIdentityForStore, type SsoProviderCfg } from "./identity.ts";
import type { Store } from "./types.ts";
// deno-lint-ignore no-explicit-any
type AnyDb = any;

const JWKS_URL = "https://issuer.example.test/.well-known/jwks.json";
const ISSUER = "https://issuer.example.test/";
const KID = "id-key-1";

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
pubJwk.kid = KID; pubJwk.use = "sig"; pubJwk.alg = "RS256";
const JWKS = { keys: [pubJwk] };

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  if (String(input) === JWKS_URL) return Promise.resolve(new Response(JSON.stringify(JWKS), { status: 200 }));
  return realFetch(input as string);
  // deno-lint-ignore no-explicit-any
}) as any;

async function signRs256(payload: Record<string, unknown>): Promise<string> {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, rsa.privateKey, new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource);
  return `${h}.${p}.${b64urlBytes(new Uint8Array(sig))}`;
}

// A db mock whose identity_providers query resolves to the given rows.
function mockDb(rows: unknown[]): AnyDb {
  const chain: AnyDb = {
    select: () => chain,
    eq: () => chain,
    then: (res: (v: { data: unknown[] }) => void) => res({ data: rows }),
  };
  return { from: () => chain };
}

const future = Math.floor(Date.now() / 1000) + 3600;
const legacyStore = { id: "s1", slug: "acme", sso_jwks_url: JWKS_URL, sso_issuer: ISSUER } as unknown as Store;
const bareStore = { id: "s2", slug: "bare" } as unknown as Store;

Deno.test("legacy fallback: a store with no provider rows still verifies via its sso_* columns", async () => {
  const jwt = await signRs256({ email: "ada@corp.test", iss: ISSUER, exp: future });
  const v = await verifyIdentityForStore(mockDb([]), legacyStore, jwt);
  assertEquals(v.claim?.email, "ada@corp.test");
});

Deno.test("new provider row: JWKS provider verifies", async () => {
  const jwt = await signRs256({ email: "grace@corp.test", iss: ISSUER, exp: future });
  const rows = [{ jwks_url: JWKS_URL, issuer: ISSUER, auto_admit: true }];
  const v = await verifyIdentityForStore(mockDb(rows), bareStore, jwt);
  assertEquals(v.claim?.email, "grace@corp.test");
});

Deno.test("domain gate: email outside allowed_domains is rejected", async () => {
  const jwt = await signRs256({ email: "ada@corp.test", iss: ISSUER, exp: future });
  const rows = [{ jwks_url: JWKS_URL, issuer: ISSUER, allowed_domains: ["acme.com"] }];
  const v = await verifyIdentityForStore(mockDb(rows), bareStore, jwt);
  assertEquals(v.claim, null);
});

Deno.test("domain gate: email inside allowed_domains passes", async () => {
  const jwt = await signRs256({ email: "cto@acme.com", iss: ISSUER, exp: future });
  const rows = [{ jwks_url: JWKS_URL, issuer: ISSUER, allowed_domains: ["acme.com"] }];
  const v = await verifyIdentityForStore(mockDb(rows), bareStore, jwt);
  assertEquals(v.claim?.email, "cto@acme.com");
});

Deno.test("no SSO configured: anonymous store returns a clear reason, no claim", async () => {
  const jwt = await signRs256({ email: "x@corp.test", iss: ISSUER, exp: future });
  const v = await verifyIdentityForStore(mockDb([]), bareStore, jwt);
  assertEquals(v.claim, null);
  assertEquals(v.reason, "No JWKS provider is configured for this store.");
});

Deno.test("token routing: JWT picks a JWKS provider, HMAC picks a secret provider", () => {
  const providers: SsoProviderCfg[] = [
    { secret: "shhh", jwksUrl: null },
    { jwksUrl: JWKS_URL, secret: null },
  ];
  assertEquals(pickConfigForToken(providers, "a.b.c")?.jwksUrl, JWKS_URL);   // 3-part → JWKS
  assertEquals(pickConfigForToken(providers, "body.sig")?.secret, "shhh");  // 2-part → secret
  assertEquals(pickConfigForToken([], "a.b.c"), null);
});

Deno.test("loadProviders: rows win; else legacy columns synthesize one provider", async () => {
  const fromRows = await loadProviders(mockDb([{ jwks_url: "https://x/y", auto_admit: false }]), bareStore);
  assertEquals(fromRows.length, 1);
  assertEquals(fromRows[0].autoAdmit, false);

  const fromLegacy = await loadProviders(mockDb([]), legacyStore);
  assertEquals(fromLegacy.length, 1);
  assertEquals(fromLegacy[0].jwksUrl, JWKS_URL);
  assertEquals(fromLegacy[0].autoAdmit, true);

  const none = await loadProviders(mockDb([]), bareStore);
  assertEquals(none.length, 0);
});
