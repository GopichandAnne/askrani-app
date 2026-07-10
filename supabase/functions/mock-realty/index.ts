// mock-realty — a stand-in for a brokerage's MLS + CRM middleware, to demo the
// Phase 6 connector pattern for real estate. In production this lives OUTSIDE
// the platform (the brokerage's own service, wrapping a RESO/MLS Web API and a
// CRM like Follow Up Boss / kvCORE). Here it proves the end-to-end flow: the bot
// POSTs a signed tool call, this verifies the HMAC and answers — LIVE listing
// search, a CRM lead push, and a showing request — with NO core change.
//
// One endpoint serves multiple tools (routed by `tool`); each is registered as a
// separate store_integrations row so the model sees them as distinct tools.
// verify_jwt=false — auth is the X-Rani-Signature HMAC.

type Listing = {
  mls: string; address: string; type: "buy" | "rent";
  beds: number; baths: number; sqft: number; price: number; hoa?: number; status: string;
};

// A little "live MLS" — richer than the static KB, to show it goes beyond it.
const LISTINGS: Listing[] = [
  { mls: "MLS1001", address: "214 Maple Street", type: "buy", beds: 3, baths: 2, sqft: 1850, price: 465000, hoa: 45, status: "active" },
  { mls: "MLS1002", address: "88 Riverbend Court", type: "buy", beds: 4, baths: 3, sqft: 2600, price: 625000, hoa: 0, status: "active" },
  { mls: "MLS1003", address: "7 Oakhill Lane", type: "buy", beds: 4, baths: 2, sqft: 2200, price: 549000, hoa: 60, status: "active" },
  { mls: "MLS1004", address: "1203 Cedar Ridge #5B", type: "rent", beds: 2, baths: 2, sqft: 1100, price: 2100, status: "active" },
  { mls: "MLS1005", address: "45 Birchwood Drive", type: "rent", beds: 3, baths: 2, sqft: 1500, price: 2650, status: "active" },
  { mls: "MLS1006", address: "920 Sunset Boulevard", type: "buy", beds: 2, baths: 2, sqft: 1400, price: 389000, hoa: 30, status: "active" },
];

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

function id(prefix: string) {
  return prefix + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
}

// deno-lint-ignore no-explicit-any
function mlsSearch(a: any) {
  const type = String(a.type ?? "").toLowerCase();
  const results = LISTINGS.filter((l) =>
    (!type || (type.includes("rent") ? l.type === "rent" : type.includes("buy") || type.includes("sale") ? l.type === "buy" : true)) &&
    (a.beds == null || l.beds >= Number(a.beds)) &&
    (a.max_price == null || l.price <= Number(a.max_price)) &&
    (a.min_price == null || l.price >= Number(a.min_price))
  ).slice(0, 5);
  return { found: results.length, listings: results };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const secret = Deno.env.get("MOCK_REALTY_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }
  let parsed: { tool?: string; args?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const tool = parsed.tool ?? "";
  const a = parsed.args ?? {};

  switch (tool) {
    case "mls_search":
      return json(mlsSearch(a));
    case "create_lead":
      return json({
        ok: true,
        lead_id: id("LEAD"),
        note: "Lead saved to the CRM and assigned to the agent, who will follow up.",
      });
    case "book_showing":
      return json({
        ok: true,
        showing_id: id("SHOW"),
        note: `Showing request for ${a.listing ?? "the property"} sent to the agent's calendar — they'll confirm the exact time.`,
      });
    default:
      return json({ error: `unknown tool: ${tool}` }, 400);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
