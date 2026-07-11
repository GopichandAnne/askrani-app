// mock-restaurant — a stand-in for a restaurant's POS + payments middleware, to
// demo the full ordering loop. In production this lives OUTSIDE the platform
// (the restaurant's own service wrapping a POS like Toast/Square/Clover and a
// payment provider like Stripe/Square). It proves the loop with NO core change:
// the bot POSTs a signed tool call, this verifies the HMAC and answers —
//   place_pos_order    -> push the order to the kitchen POS, return a ticket
//   create_payment_link-> a HOSTED checkout URL (card is NEVER taken in chat)
//
// One endpoint serves both tools (routed by `tool`). verify_jwt=false — auth is
// the X-Rani-Signature HMAC.

function id(prefix: string) {
  return prefix + "-" + crypto.randomUUID().slice(0, 6).toUpperCase();
}

// deno-lint-ignore no-explicit-any
function placePosOrder(a: any) {
  // In production: translate items -> the POS's order API (Toast/Square/Clover).
  const items = Array.isArray(a.items) ? a.items : [];
  const type = String(a.order_type ?? "pickup").toLowerCase();
  const eta = type.includes("deliver") ? "40–50 min" : "20–25 min";
  return {
    ok: true,
    ticket: id("TKT"),
    status: "sent to the kitchen",
    order_type: type,
    item_count: items.length,
    eta,
    note: `Order fired to the POS. ${type.includes("deliver") ? "Out for delivery" : "Ready for pickup"} in about ${eta}.`,
  };
}

// deno-lint-ignore no-explicit-any
function createPaymentLink(a: any) {
  // In production: call Stripe/Square to create a Payment Link for the amount.
  const amount = Number(a.amount ?? 0);
  const ref = String(a.order_ref ?? id("ORD"));
  return {
    ok: true,
    order_ref: ref,
    amount: amount || null,
    payment_url: `https://pay.spiceroute.example/checkout/${ref}`,
    note:
      "Secure hosted checkout link — the customer pays on the restaurant's payment page. " +
      "Never ask for or accept card numbers in chat.",
  };
}

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const secret = Deno.env.get("MOCK_RESTAURANT_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }
  let parsed: { tool?: string; args?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const a = parsed.args ?? {};
  switch (parsed.tool ?? "") {
    case "place_pos_order":
      return json(placePosOrder(a));
    case "create_payment_link":
      return json(createPaymentLink(a));
    default:
      return json({ error: `unknown tool: ${parsed.tool}` }, 400);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
