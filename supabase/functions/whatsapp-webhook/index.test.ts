// Deno tests for the webhook's security gate. Run:
//   deno test --allow-env --allow-net supabase/functions/whatsapp-webhook/index.test.ts
//
// Focus: the X-Hub-Signature-256 boundary. With verify_jwt=false this HMAC is
// the ONLY thing stopping forged inbound messages/orders, so missing and wrong
// signatures must both be rejected with 401, and only a valid signature may pass
// the gate.

import { assertEquals } from "jsr:@std/assert@1";

const SECRET = "test-app-secret";
Deno.env.set("WA_APP_SECRET", SECRET);
Deno.env.set("WA_VERIFY_TOKEN", "vtok");
// Dummy DB env so serviceClient() constructs; the test payload has an empty
// `entry`, so no query is made (hermetic — no network to a DB).
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "dummy");

const { handler } = await import("./index.ts");

// Empty entry -> passes the gate but does no DB work.
const BODY = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return (
    "sha256=" +
    [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

function post(headers: Record<string, string>): Request {
  return new Request("http://localhost/whatsapp-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: BODY,
  });
}

Deno.test("POST with NO signature header -> 401", async () => {
  const res = await handler(post({}));
  assertEquals(res.status, 401);
});

Deno.test("POST with WRONG signature -> 401", async () => {
  const res = await handler(
    post({ "x-hub-signature-256": "sha256=" + "0".repeat(64) }),
  );
  assertEquals(res.status, 401);
});

Deno.test("POST with signature for a DIFFERENT body -> 401", async () => {
  // valid HMAC, but of other bytes — must not validate this request's body
  const otherSig = await sign(JSON.stringify({ tampered: true }), SECRET);
  const res = await handler(post({ "x-hub-signature-256": otherSig }));
  assertEquals(res.status, 401);
});

Deno.test("POST with VALID signature passes the gate -> 200", async () => {
  const res = await handler(post({ "x-hub-signature-256": await sign(BODY, SECRET) }));
  assertEquals(res.status, 200);
});

Deno.test("GET verify with correct token -> 200 + challenge", async () => {
  const res = await handler(
    new Request(
      "http://localhost/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=vtok&hub.challenge=99",
    ),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "99");
});

Deno.test("GET verify with wrong token -> 403", async () => {
  const res = await handler(
    new Request(
      "http://localhost/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=99",
    ),
  );
  assertEquals(res.status, 403);
});
