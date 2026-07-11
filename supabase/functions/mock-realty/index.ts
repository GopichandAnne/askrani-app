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

// RESO-Data-Dictionary-shaped listing (the fields a real RESO Web API / IDX feed
// exposes). A production connector would fetch these from the MLS instead of a
// static array — the shape returned to the bot stays the same.
type Listing = {
  mls: string; address: string; city: string; type: "buy" | "rent";
  property_type: string; // RESO PropertyType, e.g. "Single Family Residence", "Condominium"
  beds: number; baths: number; sqft: number; price: number; hoa: number;
  pool: boolean; year: number; garage: number; status: string; // "Active"
  courtesy: string; // listing brokerage — IDX attribution is required
  desc: string;
};

const LISTINGS: Listing[] = [
  { mls: "MLS1001", address: "214 Maple Street", city: "Cedar Park", type: "buy", property_type: "Single Family Residence", beds: 3, baths: 2, sqft: 1850, price: 465000, hoa: 45, pool: false, year: 2015, garage: 2, status: "Active", courtesy: "Cedar & Oak Realty", desc: "Updated kitchen, large fenced backyard, open floor plan." },
  { mls: "MLS1002", address: "88 Riverbend Court", city: "Cedar Park", type: "buy", property_type: "Single Family Residence", beds: 4, baths: 3, sqft: 2600, price: 625000, hoa: 0, pool: true, year: 2019, garage: 3, status: "Active", courtesy: "Cedar & Oak Realty", desc: "Private pool, cul-de-sac lot, three-car garage, no HOA." },
  { mls: "MLS1003", address: "7 Oakhill Lane", city: "Austin", type: "buy", property_type: "Single Family Residence", beds: 4, baths: 2, sqft: 2200, price: 549000, hoa: 60, pool: false, year: 2012, garage: 2, status: "Active", courtesy: "Hill Country Homes", desc: "Mature trees, covered patio, home office, recent roof." },
  { mls: "MLS1004", address: "1203 Cedar Ridge #5B", city: "Cedar Park", type: "rent", property_type: "Condominium", beds: 2, baths: 2, sqft: 1100, price: 2100, hoa: 0, pool: true, year: 2018, garage: 0, status: "Active", courtesy: "Cedar & Oak Realty", desc: "In-unit laundry, community pool, one assigned spot, small pets OK." },
  { mls: "MLS1005", address: "45 Birchwood Drive", city: "Round Rock", type: "rent", property_type: "Single Family Residence", beds: 3, baths: 2, sqft: 1500, price: 2650, hoa: 0, pool: false, year: 2016, garage: 2, status: "Active", courtesy: "Cedar & Oak Realty", desc: "Single-family rental, fenced yard, two-car garage." },
  { mls: "MLS1006", address: "920 Sunset Boulevard", city: "Austin", type: "buy", property_type: "Condominium", beds: 2, baths: 2, sqft: 1400, price: 389000, hoa: 30, pool: false, year: 2010, garage: 1, status: "Active", courtesy: "Cedar & Oak Realty", desc: "Starter condo, walkable location, updated bathrooms." },
];

// Public photo URLs (a RESO Media resource). In production these are the MLS's
// hosted photo URLs; here they point at demo images in the public branding bucket.
const PHOTO_BASE = "https://ctdczunzetcftcadbrot.supabase.co/storage/v1/object/public/branding/realty-demo";
const SLOTS = ["front", "kitchen", "living"];
function photosFor(mls: string): string[] {
  return SLOTS.map((s) => `${PHOTO_BASE}/${mls.toLowerCase()}-${s}.svg`);
}
// The brokerage's IDX detail page for a listing (has the full photo set + map).
function listingUrl(mls: string): string {
  return `https://cedarandoak.example/listings/${mls}`;
}
const IDX_DISCLAIMER = "Listing data via Demo MLS IDX — information deemed reliable but not guaranteed.";

// deno-lint-ignore no-explicit-any
function listingDetails(a: any) {
  const q = String(a.query ?? a.mls ?? a.address ?? "").toLowerCase().trim();
  if (!q) return { found: false, note: "no listing specified" };
  const hit = LISTINGS.find((l) =>
    l.mls.toLowerCase() === q ||
    l.address.toLowerCase().includes(q) ||
    q.includes(l.address.toLowerCase().split(" ").slice(1, 3).join(" ")) // e.g. "maple street"
  );
  if (!hit) return { found: false };
  return {
    found: true,
    mls: hit.mls, address: hit.address, city: hit.city, property_type: hit.property_type,
    beds: hit.beds, baths: hit.baths, sqft: hit.sqft, price: hit.price, hoa: hit.hoa,
    pool: hit.pool, year_built: hit.year, garage: hit.garage, status: hit.status,
    description: hit.desc,
    courtesy: `Listing courtesy of ${hit.courtesy}`,
    photos: photosFor(hit.mls),
    listing_url: listingUrl(hit.mls),
    disclaimer: IDX_DISCLAIMER,
  };
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

// Criteria-based search — the connector translates these into an MLS query (a
// RESO OData $filter in production). Accepts the common buyer criteria.
// deno-lint-ignore no-explicit-any
function mlsSearch(a: any) {
  const type = String(a.type ?? "").toLowerCase();
  const city = String(a.city ?? "").toLowerCase().trim();
  const ptype = String(a.property_type ?? "").toLowerCase().trim();
  const poolStr = String(a.pool ?? "").toLowerCase();
  const wantPool = a.pool === true || poolStr === "true" || poolStr === "yes";
  const results = LISTINGS.filter((l) =>
    (!type || (type.includes("rent") ? l.type === "rent" : (type.includes("buy") || type.includes("sale") || type.includes("purchase")) ? l.type === "buy" : true)) &&
    (a.beds == null || l.beds >= Number(a.beds)) &&
    (a.baths == null || l.baths >= Number(a.baths)) &&
    (a.max_price == null || l.price <= Number(a.max_price)) &&
    (a.min_price == null || l.price >= Number(a.min_price)) &&
    (a.min_sqft == null || l.sqft >= Number(a.min_sqft)) &&
    (!city || l.city.toLowerCase().includes(city) || city.includes(l.city.toLowerCase())) &&
    (!ptype ||
      (ptype.includes("condo") ? l.property_type === "Condominium"
        : (ptype.includes("single") || ptype.includes("house") || ptype.includes("family")) ? l.property_type.includes("Single")
        : l.property_type.toLowerCase().includes(ptype))) &&
    (!wantPool || l.pool)
  ).slice(0, 6);
  return {
    count: results.length,
    disclaimer: IDX_DISCLAIMER,
    listings: results.map((l) => ({
      mls: l.mls, address: l.address, city: l.city, property_type: l.property_type,
      beds: l.beds, baths: l.baths, sqft: l.sqft, price: l.price, hoa: l.hoa,
      pool: l.pool, status: l.status,
      courtesy: `Listing courtesy of ${l.courtesy}`,
      photos: photosFor(l.mls),
      listing_url: listingUrl(l.mls),
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
