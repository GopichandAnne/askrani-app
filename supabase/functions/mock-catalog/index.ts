// mock-catalog — a stand-in for a merchant's live catalogue / inventory API
// (Clover, Square, Toast, Shopify, a PIM…). It demonstrates the platform-right
// pattern: query the source LIVE and return items with LIVE image URLs (the bot
// renders them via send_photo_urls — we never copy the bytes). In production this
// is a thin adapter over the merchant's real API; the returned shape stays the
// same. Routed by `tool`; HMAC-signed (X-Rani-Signature); verify_jwt=false.
//
// Tools:
//   menu_search      -> items matching a query/category (with image URLs)
//   item_details     -> one item: full info + all images + description
//   check_availability-> live in-stock + price for the items being ordered

type Item = {
  name: string; category: string; price: number; desc: string;
  in_stock: boolean; images: string[];
};

const CS = "https://cloverstatic.com/menu-assets/items/";
const PL = "https://pluto-images.owner.com/funnel/images/";

// The merchant's live catalogue (here: Chattar Pattar's real items + real photo
// URLs). A production adapter fetches this from the POS; images can be several
// per item — the schema supports a gallery.
const MENU: Item[] = [
  { name: "Samosa Chaat", category: "Chaat", price: 8.99, desc: "Crispy samosas with spiced chickpeas, yogurt and chutneys.", in_stock: true, images: [`${CS}CXXPE0HZQMESA.jpeg`] },
  { name: "Pani Puri", category: "Chaat", price: 8.99, desc: "Crisp puris with spiced potato and tangy mint water.", in_stock: true, images: [`${CS}Y6FGRNKXWENY4.jpeg`] },
  { name: "Sev Puri", category: "Chaat", price: 8.99, desc: "Flat puris topped with potato, chutneys and sev.", in_stock: true, images: [`${CS}D91078R3A934A.jpeg`] },
  { name: "Dahi Puri", category: "Chaat", price: 8.99, desc: "Puris with sweet yogurt, chutneys and sev.", in_stock: true, images: [`${CS}QZNN4027T0CJP.jpeg`] },
  { name: "Cholay Chaat", category: "Chaat", price: 8.99, desc: "Spiced chickpea chaat with onions and chutneys.", in_stock: true, images: [`${CS}6AXNN6W4J16KA.jpeg`] },
  { name: "Ragda Patties Chaat", category: "Chaat", price: 8.99, desc: "Potato patties over white pea curry with chutneys.", in_stock: true, images: [`${CS}SKZHG0FB662QW.jpeg`] },
  { name: "Vegetable Maggi Masala", category: "Chaat", price: 7.99, desc: "Masala Maggi noodles with vegetables.", in_stock: true, images: [`${CS}A1CX1N75Z7JHY.jpeg`] },
  { name: "Bombay Vada Pav", category: "Mumbai", price: 4.99, desc: "Mumbai's classic — spiced potato fritter in a bun.", in_stock: true, images: [`${CS}NH937X8K6F3W6.jpeg`] },
  { name: "Shezwan Vada Pav", category: "Mumbai", price: 6.99, desc: "Vada pav with spicy Schezwan chutney.", in_stock: true, images: [`${CS}CX6N5TPJYCZA2.jpeg`] },
  { name: "Pav Bhaji", category: "Mumbai", price: 10.99, desc: "Buttery mashed-vegetable curry with soft pav.", in_stock: true, images: [`${PL}cf65e690-f39f-48dc-b246-13159ba9f22c?w=640&fit=cover`] },
  { name: "Masala Pav", category: "Mumbai", price: 10.99, desc: "Pav tossed in spiced bhaji masala.", in_stock: true, images: [`${CS}X4AS3GDC3AWQ0.jpeg`] },
  { name: "Paneer Tikka Kathi Roll", category: "Kathi Roll", price: 12.99, desc: "Grilled paneer tikka wrapped in a paratha roll.", in_stock: true, images: [`${CS}ZEQHAS79GQKCA.jpeg`] },
  { name: "Bombay Grill Sandwich", category: "Sandwich", price: 8.99, desc: "Grilled Bombay-style veg sandwich with chutney.", in_stock: true, images: [`${CS}HPG59BG93NSWA.jpeg`] },
  { name: "Junglee Paneer Grill Sandwich", category: "Sandwich", price: 10.99, desc: "Spicy paneer grilled sandwich.", in_stock: true, images: [`${CS}QZ6JNDJWQN6NC.jpeg`] },
  { name: "Paneer Pizza Grilled Sandwich", category: "Sandwich", price: 14.99, desc: "Paneer, cheese and pizza flavors, grilled.", in_stock: true, images: [`${PL}c6a6cad5-b531-42e2-b833-676920ed7557?w=640&fit=cover`] },
  { name: "Tandoor Mayo Cheese Fries", category: "Fries", price: 7.99, desc: "Fries loaded with tandoor mayo and cheese.", in_stock: true, images: [`${CS}K2AHFCK32PA5T.jpeg`] },
  { name: "Chatkara Chilli Cheese Fries", category: "Fries", price: 10.99, desc: "Chilli-tossed fries with cheese.", in_stock: true, images: [`${PL}2c0be208-a8f3-4cca-adac-fb426b15960f?w=640&fit=cover`] },
  { name: "Punjabi Samosa", category: "Fried", price: 4.99, desc: "Two classic potato-pea samosas.", in_stock: true, images: [`${CS}G39WS2VXFZB7G.jpeg`] },
  { name: "Aloo Bonda", category: "Fried", price: 6.99, desc: "Four spiced potato fritters.", in_stock: true, images: [`${CS}RSQT1H59790Q2.jpeg`] },
  { name: "Mango Falooda", category: "Dessert", price: 8.99, desc: "Mango falooda with vermicelli and basil seeds.", in_stock: true, images: [`${CS}YMT64HRT2AYXM.jpeg`] },
  { name: "Pistachio Falooda", category: "Dessert", price: 8.99, desc: "Pistachio falooda.", in_stock: false, images: [`${CS}HQ5SGM9K6ET4B.jpeg`] },
  { name: "Mango Lassi", category: "Dessert", price: 5.99, desc: "Thick sweet mango yogurt drink.", in_stock: true, images: [`${CS}RFZH7DNGTKHE0.jpeg`] },
  { name: "Gulab Jamun", category: "Dessert", price: 4.99, desc: "Warm milk dumplings in syrup.", in_stock: true, images: [`${CS}HYX39Q5BMZWPM.jpeg`] },
  { name: "Fresh Sugarcane Juice", category: "Drinks", price: 4.99, desc: "Freshly pressed sugarcane juice.", in_stock: true, images: [`${CS}HE5ARVDYRHN94.jpeg`] },
];

function scoreItem(it: Item, words: string[]): number {
  const hay = `${it.name} ${it.category} ${it.desc}`.toLowerCase();
  return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
}

// deno-lint-ignore no-explicit-any
function menuSearch(a: any) {
  const q = String(a.query ?? "").toLowerCase();
  const cat = String(a.category ?? "").toLowerCase().trim();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const results = MENU
    .map((it) => ({ it, s: scoreItem(it, words) + (cat && it.category.toLowerCase().includes(cat) ? 3 : 0) }))
    .filter((x) => x.s > 0 || (cat && x.it.category.toLowerCase().includes(cat)))
    .sort((x, y) => y.s - x.s)
    .slice(0, 8)
    .map((x) => ({
      name: x.it.name, category: x.it.category, price: x.it.price,
      in_stock: x.it.in_stock, image: x.it.images[0], images: x.it.images,
    }));
  return { found: results.length, items: results, note: "Live from the menu. Show photos with send_photo_urls using each item's image/images." };
}

// deno-lint-ignore no-explicit-any
function itemDetails(a: any) {
  const q = String(a.query ?? a.name ?? "").toLowerCase().trim();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const hit = MENU.map((it) => ({ it, s: scoreItem(it, words) })).sort((x, y) => y.s - x.s)[0];
  if (!hit || hit.s === 0) return { found: false };
  const it = hit.it;
  return { found: true, name: it.name, category: it.category, price: it.price, description: it.desc, in_stock: it.in_stock, images: it.images };
}

// deno-lint-ignore no-explicit-any
function checkAvailability(a: any) {
  const names: string[] = Array.isArray(a.items) ? a.items.map((x: unknown) => String(x)) : [];
  const out = names.map((n) => {
    const hit = MENU.find((it) => it.name.toLowerCase() === n.toLowerCase() || n.toLowerCase().includes(it.name.toLowerCase()));
    return hit ? { name: hit.name, in_stock: hit.in_stock, price: hit.price } : { name: n, in_stock: false, price: null, note: "not found" };
  });
  return { items: out };
}

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return header === "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const secret = Deno.env.get("MOCK_CATALOG_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) return json({ error: "bad signature" }, 401);
  let parsed: { tool?: string; args?: Record<string, unknown> };
  try { parsed = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  const a = parsed.args ?? {};
  switch (parsed.tool ?? "") {
    case "menu_search": return json(menuSearch(a));
    case "item_details": return json(itemDetails(a));
    case "check_availability": return json(checkAvailability(a));
    default: return json({ error: `unknown tool: ${parsed.tool}` }, 400);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
