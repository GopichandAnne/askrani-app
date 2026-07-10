// mock-pos — a stand-in "external POS/pricing system" for the Phase 6 connector
// demo. In real life this lives OUTSIDE the platform (the store's own service);
// here it proves the end-to-end flow: the bot POSTs a signed tool call, this
// endpoint verifies the HMAC and returns a live-looking price + stock.
//
// verify_jwt=false — auth is the X-Rani-Signature HMAC, not a Supabase JWT.

const CATALOG: Record<string, { name: string; price: number; unit: string; stock: number }> = {
  "4021": { name: "1 L Water (24-pack)", price: 8.5, unit: "case", stock: 120 },
  "8901": { name: "Basmati Rice 10 lb", price: 14.99, unit: "bag", stock: 40 },
  "7001": { name: "Toor Dal 4 lb", price: 6.49, unit: "bag", stock: 15 },
  "3300": { name: "Paneer 400 g", price: 4.99, unit: "pack", stock: 0 },
};

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

  // Authenticate the caller is really Rani (skip only if no secret configured).
  const secret = Deno.env.get("MOCK_POS_SECRET");
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
  const code = String(args.barcode ?? args.sku ?? args.query ?? "").trim();
  if (!code) return json({ found: false, note: "no barcode/sku/query provided" });

  const hit = CATALOG[code] ??
    Object.entries(CATALOG).find(([, v]) => v.name.toLowerCase().includes(code.toLowerCase()))?.[1];
  if (!hit) return json({ found: false });

  return json({
    found: true,
    name: hit.name,
    price: hit.price,
    currency: "USD",
    unit: hit.unit,
    in_stock: hit.stock > 0,
    stock_qty: hit.stock,
    as_of: new Date().toISOString(),
  });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
