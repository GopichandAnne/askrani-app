// web-cart — public menu + cart endpoint for the catalogue overlay.
//
// Powers the tap-to-order menu overlay in the web chat (a fast visual way to
// browse the catalogue and build the cart, instead of chatting). It shares the
// SAME server-side cart the bot uses (carts table, keyed by session_id), so the
// overlay and chat stay in sync; checkout is handed back to the bot (which runs
// each store's own order flow — built-in or a POS connector). Gated on the
// store's catalog_enabled setting. Token-validated like web-chat; verify_jwt
// stays on (browser sends the anon key).

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug } from "../_shared/config.ts";
import { addToCart, cartSubtotal, type CartLine, clearCart, removeFromCart, viewCart } from "../_shared/cart.ts";
import { browseProducts, catalogLabel, coerceFilter, maySeePrices } from "../_shared/catalog.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function summarize(lines: CartLine[]) {
  return {
    items: lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      unit_price: l.unit_price,
      line_total: l.line_total,
      request: l.request,
    })),
    count: lines.reduce((s, l) => s + l.quantity, 0),
    subtotal: cartSubtotal(lines),
    currency: "USD",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const slug = String(body.slug ?? "").trim();
  const token = String(body.token ?? "").trim();
  const sessionId = String(body.session_id ?? "").trim();
  const action = String(body.action ?? "").trim();
  if (!slug || !sessionId.startsWith("web_")) return json({ error: "bad request" }, 400);

  const db = serviceClient();
  const store = await getStoreBySlug(db, slug);
  if (!store) return json({ error: "unknown store" }, 404);

  // Validate the visitor token (same rule as web-chat).
  const { data: tok } = await db
    .from("store_tokens")
    .select("active, listing_ref")
    .eq("store_id", store.id)
    .eq("token", token)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1);
  const tokRow = tok?.[0] as { active: boolean; listing_ref: string | null } | undefined;
  if (!tokRow || (!tokRow.active && !tokRow.listing_ref)) {
    return json({ error: "invalid or expired link" }, 403);
  }

  // Gate on catalogue mode — the overlay is only for catalogue stores.
  const { data: cat } = await db
    .from("agent_config")
    .select("value")
    .eq("store_id", store.id)
    .eq("key", "catalog_enabled")
    .maybeSingle();
  if (String(cat?.value ?? "").toLowerCase() !== "true") {
    return json({ error: "catalogue not enabled" }, 403);
  }

  switch (action) {
    // Filtered, faceted, gate-aware page of the catalogue. Replaces the old
    // "dump 500 rows with prices at anyone holding the link" behaviour: a
    // 1,100-item catalogue was both unusable AND leaked trade pricing straight
    // past the gate the chat enforces.
    case "menu": {
      try {
        const showPrices = await maySeePrices(db, store, { sessionId });
        const filter = coerceFilter(body.filter as Record<string, unknown>);
        const page = await browseProducts(db, store, filter, showPrices);
        return json({
          store: store.slug,
          label: await catalogLabel(db, store.id),
          filter,
          ...page,
        });
      } catch (e) {
        console.error(`[web-cart] menu: ${e instanceof Error ? e.message : e}`);
        return json({ error: "could not load the catalogue" }, 500);
      }
    }
    // Cart lines carry unit prices and lead to checkout, so when pricing is
    // members-only the cart is members-only too — otherwise an unverified
    // visitor just reads the prices back out of their own cart.
    case "add":
    case "remove":
    case "view":
    case "clear": {
      if (!(await maySeePrices(db, store, { sessionId }))) {
        return json({
          error: "Ordering is for approved accounts — verify your account email to unlock pricing.",
          needs_member: true,
        }, 403);
      }
      if (action === "add") {
        const sku = String(body.sku ?? "").trim();
        const qty = Number(body.quantity ?? 1);
        if (!sku) return json({ error: "sku required" }, 400);
        const res = await addToCart(db, store, sessionId, sku, qty);
        return json({
          ok: res.status === "added" || res.status === "removed",
          status: res.status,
          cart: summarize(res.lines),
        });
      }
      if (action === "remove") {
        const res = await removeFromCart(db, store, sessionId, String(body.sku ?? "").trim());
        return json({ ok: true, cart: summarize(res.lines) });
      }
      if (action === "clear") {
        await clearCart(db, store, sessionId);
        return json({ ok: true, cart: summarize([]) });
      }
      return json({ cart: summarize(await viewCart(db, sessionId)) });
    }
    default:
      return json({ error: `unknown action: ${action}` }, 400);
  }
});
