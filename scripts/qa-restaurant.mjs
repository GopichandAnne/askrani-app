// Restaurant diner regression harness — guards the menu/filter/facet edge cases.
//
// Seeds a deterministic fixture restaurant on a target Supabase (LOCAL by
// default) and asserts browse_products behaviour: heat/dietary/allergen filters,
// stock handling, combined filters, zero-result, category filter and the facet
// maps that drive the diner's filter chips. Idempotent — reseeds each run.
//
//   Run (local stack up):  node scripts/qa-restaurant.mjs
//   Against another target: QA_URL=... QA_SERVICE_KEY=... node scripts/qa-restaurant.mjs
//   CI: exits non-zero if any assertion fails.
//
// Deterministic by construction (fixed fixture), so a failure is a real
// regression in browse_products / the shared filter contract.

// Local Supabase defaults (well-known demo service-role key; override via env).
const URL = (process.env.QA_URL || "http://127.0.0.1:54321").replace(/\/$/, "");
const KEY =
  process.env.QA_SERVICE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const SLUG = "qa-restaurant";

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(method, path, body, prefer) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: prefer ? { ...H, Prefer: prefer } : H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
function browse(storeId, filter = {}) {
  return rest("POST", "rpc/browse_products", { p_store_id: storeId, ...filter });
}

// ── Fixture ──────────────────────────────────────────────────────────────────
const FIXTURE = [
  { sku: "qa-vindaloo", name: "QA Vindaloo", price: 12, category: "Mains", heat: "hot", dietary: ["vegetarian"], allergens: [], in_stock: true },
  { sku: "qa-panipuri", name: "QA Pani Puri", price: 6, category: "Chaat", heat: "hot", dietary: ["vegetarian", "vegan"], allergens: [], in_stock: true },
  { sku: "qa-butter", name: "QA Butter Paneer", price: 13, category: "Mains", heat: "mild", dietary: ["vegetarian"], allergens: ["milk"], in_stock: true },
  { sku: "qa-salad", name: "QA Green Salad", price: 5, category: "Sides", heat: null, dietary: ["vegetarian", "vegan"], allergens: [], in_stock: true },
  { sku: "qa-cashew", name: "QA Cashew Curry", price: 11, category: "Mains", heat: "medium", dietary: ["vegetarian"], allergens: ["tree_nuts"], in_stock: true },
  { sku: "qa-oos", name: "QA Sold-Out Special", price: 15, category: "Mains", heat: "hot", dietary: ["vegetarian"], allergens: [], in_stock: false },
];

async function seed() {
  const existing = await rest("GET", `stores?slug=eq.${SLUG}&select=id`);
  let storeId = existing[0]?.id;
  if (!storeId) {
    const row = await rest(
      "POST",
      "stores",
      { slug: SLUG, store_display_name: "QA Restaurant", business_type: "restaurant", active: true, whatsapp_status: "inactive" },
      "return=representation",
    );
    storeId = row[0].id;
  }
  await rest("DELETE", `products?store_id=eq.${storeId}&sku=like.qa-*`);
  await rest("POST", "products", FIXTURE.map((p) => ({ ...p, store_id: storeId, currency: "USD" })), "return=minimal");
  return storeId;
}

// ── Assertions ────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const facetMap = (arr) => Object.fromEntries((arr || []).map((f) => [f.value, f.count]));

async function run() {
  console.log(`QA restaurant harness → ${URL} (store ${SLUG})\n`);
  const id = await seed();

  const CASES = [
    ["no filter → 6", {}, 6],
    ["heat=[hot] → 3 (incl. sold-out)", { p_heat: ["hot"] }, 3],
    ["heat=[hot] + in_stock=true → 2", { p_heat: ["hot"], p_in_stock: true }, 2],
    ["heat=[mild,medium] → 2", { p_heat: ["mild", "medium"] }, 2],
    ["dietary=[vegan] → 2", { p_dietary: ["vegan"] }, 2],
    ["dietary=[vegetarian] → 6", { p_dietary: ["vegetarian"] }, 6],
    ["exclude tree_nuts → 5", { p_exclude_allergens: ["tree_nuts"] }, 5],
    ["exclude milk → 5", { p_exclude_allergens: ["milk"] }, 5],
    ["category=[Mains] → 4", { p_categories: ["Mains"] }, 4],
    ["zero-result heat=hot + Sides → 0", { p_heat: ["hot"], p_categories: ["Sides"] }, 0],
    ["combined vegan + hot → 1", { p_dietary: ["vegan"], p_heat: ["hot"] }, 1],
  ];
  for (const [name, filter, expected] of CASES) {
    const r = await browse(id, filter);
    check(name, r.total === expected, `got total=${r.total}`);
  }

  // Facets (drive the diner filter chips)
  const base = await browse(id, {});
  const heat = facetMap(base.facets.heat);
  const diet = facetMap(base.facets.dietary);
  const allerg = facetMap(base.facets.allergens);
  check("facet heat = {hot:3,medium:1,mild:1}", heat.hot === 3 && heat.medium === 1 && heat.mild === 1, JSON.stringify(heat));
  check("facet dietary = {vegetarian:6,vegan:2}", diet.vegetarian === 6 && diet.vegan === 2, JSON.stringify(diet));
  check("facet allergens = {milk:1,tree_nuts:1}", allerg.milk === 1 && allerg.tree_nuts === 1, JSON.stringify(allerg));
  check("null-heat dish excluded from heat facet", !("null" in heat) && Object.values(heat).reduce((a, b) => a + b, 0) === 5, JSON.stringify(heat));

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error("harness error:", e.message);
  process.exit(2);
});
