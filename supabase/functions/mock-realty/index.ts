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
  year?: number; garage?: number; desc?: string;
};

// A little "live MLS" — richer than the static KB, to show it goes beyond it.
const LISTINGS: Listing[] = [
  { mls: "MLS1001", address: "214 Maple Street", type: "buy", beds: 3, baths: 2, sqft: 1850, price: 465000, hoa: 45, status: "active", year: 2015, garage: 2, desc: "Updated kitchen, large fenced backyard, open floor plan." },
  { mls: "MLS1002", address: "88 Riverbend Court", type: "buy", beds: 4, baths: 3, sqft: 2600, price: 625000, hoa: 0, status: "active", year: 2019, garage: 3, desc: "Pool, cul-de-sac lot, three-car garage, no HOA." },
  { mls: "MLS1003", address: "7 Oakhill Lane", type: "buy", beds: 4, baths: 2, sqft: 2200, price: 549000, hoa: 60, status: "active", year: 2012, garage: 2, desc: "Mature trees, covered patio, home office, recent roof." },
  { mls: "MLS1004", address: "1203 Cedar Ridge #5B", type: "rent", beds: 2, baths: 2, sqft: 1100, price: 2100, status: "active", year: 2018, garage: 0, desc: "In-unit laundry, one assigned spot, small pets OK with deposit." },
  { mls: "MLS1005", address: "45 Birchwood Drive", type: "rent", beds: 3, baths: 2, sqft: 1500, price: 2650, status: "active", year: 2016, garage: 2, desc: "Single-family rental, fenced yard, two-car garage." },
  { mls: "MLS1006", address: "920 Sunset Boulevard", type: "buy", beds: 2, baths: 2, sqft: 1400, price: 389000, hoa: 30, status: "active", year: 2010, garage: 1, desc: "Starter home, walkable location, updated bathrooms." },
];

// deno-lint-ignore no-explicit-any
function listingDetails(a: any) {
  const q = String(a.query ?? a.mls ?? a.address ?? "").toLowerCase().trim();
  if (!q) return { found: false, note: "no listing specified" };
  const hit = LISTINGS.find((l) =>
    l.mls.toLowerCase() === q ||
    l.address.toLowerCase().includes(q) ||
    q.includes(l.address.toLowerCase().split(" ").slice(1, 3).join(" ")) // e.g. "maple street"
  );
  return hit ? { found: true, ...hit } : { found: false };
}

// A demo AVM (automated valuation) — the seller lead magnet. Real deployments
// wrap an actual AVM/CMA source; always framed as an estimate + agent CMA.
// deno-lint-ignore no-explicit-any
function homeValue(a: any) {
  const sqft = Number(a.sqft ?? 0);
  const ppsf = 265; // demo price-per-sqft for the area
  if (sqft > 0) {
    const est = Math.round((sqft * ppsf) / 1000) * 1000;
    return {
      address: a.address ?? null,
      estimated_value: est,
      range_low: Math.round((est * 0.94) / 1000) * 1000,
      range_high: Math.round((est * 1.06) / 1000) * 1000,
      basis: `about $${ppsf} per sq ft for the area`,
      note: "This is an automated estimate — the agent will prepare a precise comparative market analysis (CMA).",
    };
  }
  return {
    address: a.address ?? null,
    estimated_value: null,
    note: "I need the home's square footage (and ideally beds/baths and condition) to estimate; the agent can prepare a full CMA.",
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
  // Brief cards only — call listing_details for the full record.
  return {
    found: results.length,
    listings: results.map((l) => ({
      mls: l.mls, address: l.address, type: l.type,
      beds: l.beds, baths: l.baths, sqft: l.sqft, price: l.price, status: l.status,
    })),
  };
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
    case "listing_details":
      return json(listingDetails(a));
    case "get_home_value":
      return json(homeValue(a));
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
