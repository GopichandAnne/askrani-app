// mock-pay — a stand-in "payment provider" for the Phase 3 write-action demo.
// The bot NEVER charges a card; a payment connector returns a HOSTED CHECKOUT
// LINK and the bot shares it. This proves that flow end-to-end: it verifies the
// signed request and returns a link (no card data ever touches the chat).
//
// verify_jwt=false — auth is the X-Rani-Signature HMAC, like a real connector.

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();

  const secret = Deno.env.get("MOCK_PAY_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }

  let parsed: { args?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const args = parsed.args ?? {};
  const amount = Number(args.amount ?? 0);
  const description = String(args.description ?? "Your order");

  // A real provider would create a checkout session; we return a demo link.
  const ref = "PAY-" + crypto.randomUUID().slice(0, 8).toUpperCase();
  return json({
    ok: true,
    checkout_url: `https://pay.example.com/c/${ref}`,
    reference: ref,
    amount: amount || null,
    currency: "USD",
    description,
    note: "Hosted checkout — the customer pays securely on this page; no card details in chat.",
  });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
