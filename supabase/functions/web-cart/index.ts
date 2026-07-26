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
import { addToCart, cartSubtotal, type CartLine, clearCart, removeFromCart, setLineNote, viewCart } from "../_shared/cart.ts";
import { placeOrder } from "../_shared/order.ts";
import { createCheckoutSession, storeStripeKey } from "../_shared/stripe.ts";
import {
  browseProducts,
  catalogLabel,
  coerceFilter,
  maySeePrices,
  verifyBrowseIdentity,
} from "../_shared/catalog.ts";
import { bindMemberSession, cartSessionFor, resolveMember } from "../_shared/members.ts";
import { rewardBalanceCents } from "../_shared/rewards.ts";
import { getOrCreateReferralLink, trackedUrl } from "../_shared/referral.ts";

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
      notes: l.notes,
      modifiers: l.modifiers ?? [],
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

  // A browse link carries a signed identity (?k=). Redeem it BEFORE anything
  // else: it decides whether this visitor sees prices and, crucially, WHICH cart
  // they're touching. Verified server-side — the client only relays the key.
  const browseKey = String(body.browse_key ?? "").trim();
  if (browseKey) {
    const claim = await verifyBrowseIdentity(slug, browseKey);
    if (claim) {
      await bindMemberSession(db, sessionId, store.id, claim.member, {
        cartSessionId: claim.cart,
        expiresAt: new Date(claim.exp).toISOString(),
      });
    }
  }
  // Cart operations act on the adopted cart when there is one, so the grid and
  // the customer's WhatsApp thread are the same basket.
  const cartSession = await cartSessionFor(db, store.id, sessionId);

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
        // Has the store connected its OWN Stripe? (not the platform env fallback) —
        // drives whether the diner offers "Pay now" vs pay-at-counter only.
        const { data: pc } = await db
          .from("store_provider_credentials")
          .select("credentials, connected")
          .eq("store_id", store.id)
          .eq("provider", "stripe")
          .maybeSingle();
        const payments_enabled = !!(pc && pc.connected !== false && (pc.credentials as { secret_key?: string } | null)?.secret_key);
        // Premium voice (OpenAI TTS): ON for all catalogue stores; owner opts out
        // with tts_enabled=false and picks the female voice via tts_voice.
        const { data: vcfg } = await db
          .from("agent_config")
          .select("key, value")
          .eq("store_id", store.id)
          .in("key", ["tts_enabled", "tts_voice"]);
        const vconf = Object.fromEntries((vcfg ?? []).map((r) => [r.key, String(r.value ?? "")]));
        const tts_premium = (vconf.tts_enabled ?? "true").toLowerCase() !== "false";
        const tts_voice = (vconf.tts_voice || "aria").toLowerCase();
        return json({
          store: store.slug,
          label: await catalogLabel(db, store.id),
          filter,
          payments_enabled,
          tts_premium,
          tts_voice,
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
    case "note":
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
        // Optional modifier selection: [{group_id, option_id}, …]. Priced server-side.
        const rawMods = Array.isArray(body.modifiers) ? body.modifiers : null;
        const mods = rawMods
          ? rawMods
            .map((m) => ({ group_id: String((m as { group_id?: unknown }).group_id ?? ""), option_id: String((m as { option_id?: unknown }).option_id ?? "") }))
            .filter((m) => m.group_id && m.option_id)
          : null;
        // Optional per-dish note (allergies / "no onions" / prep) — like a server's ticket note.
        const note = typeof body.note === "string" ? body.note : null;
        const res = await addToCart(db, store, cartSession, sku, qty, note, mods);
        return json({
          ok: res.status === "added" || res.status === "removed",
          status: res.status,
          error: res.error,
          cart: summarize(res.lines),
        });
      }
      if (action === "note") {
        const sku = String(body.sku ?? "").trim();
        if (!sku) return json({ error: "sku required" }, 400);
        const res = await setLineNote(db, store, cartSession, sku, typeof body.note === "string" ? body.note : null);
        return json({ ok: res.ok, cart: summarize(res.lines) });
      }
      if (action === "remove") {
        const res = await removeFromCart(db, store, cartSession, String(body.sku ?? "").trim());
        return json({ ok: true, cart: summarize(res.lines) });
      }
      if (action === "clear") {
        await clearCart(db, store, cartSession);
        return json({ ok: true, cart: summarize([]) });
      }
      return json({ cart: summarize(await viewCart(db, cartSession)) });
    }
    // Deterministic checkout for the diner surface — finalizes the shared cart
    // into a pending_approval order the panel picks up, WITHOUT routing the money
    // step through the model. Carries the guest's typed name and (for dine-in) the
    // table label so the kitchen knows who and where. Same price/stock re-check as
    // every other order (done inside placeOrder).
    case "place": {
      if (!(await maySeePrices(db, store, { sessionId }))) {
        return json({
          error: "To order here I'll need to know you — continue on WhatsApp.",
          needs_member: true,
        }, 403);
      }
      const name = String(body.name ?? "").trim();
      const rawFul = String(body.fulfillment ?? "").trim();
      const fulfillment = rawFul === "delivery" ? "delivery" : rawFul === "dine_in" ? "dine_in" : "pickup";
      const tableLabel = String(body.table_label ?? "").trim();
      const res = await placeOrder(db, store, cartSession, fulfillment, "Confirmed at the table via Ask Rani", {
        customerName: name || null,
        tableLabel: fulfillment === "dine_in" ? tableLabel || null : null,
      });
      // placed:false is a real, expected outcome (empty cart, out_of_stock,
      // price_changed) the client renders — return 200 so the browser reads the body.
      return json(res, 200);
    }
    // Start a Stripe checkout for an already-placed order. Money goes to the STORE's
    // own Stripe; a signed webhook flips the order to paid. If the store hasn't
    // connected Stripe, the diner falls back to pay-at-counter.
    case "pay": {
      const orderId = String(body.order_id ?? "").trim();
      if (!orderId) return json({ error: "order_id required" }, 400);
      const { data: ord } = await db
        .from("orders")
        .select("order_id, total, currency, session_id, payment_status")
        .eq("order_id", orderId)
        .eq("store_slug", store.slug)
        .maybeSingle();
      if (!ord) return json({ error: "order not found" }, 404);
      if (ord.session_id !== cartSession && ord.session_id !== sessionId) {
        return json({ error: "not your order" }, 403);
      }
      if (ord.payment_status === "paid") return json({ already_paid: true });
      const key = await storeStripeKey(db, store.id);
      if (!key) return json({ no_stripe: true }); // owner hasn't connected Stripe
      const amount = Number(ord.total ?? 0);
      if (!(amount > 0)) return json({ error: "order has no total to pay" }, 400);

      const tableLabel = String(body.table ?? "").trim();
      const q = `t=${encodeURIComponent(token)}${tableLabel ? `&table=${encodeURIComponent(tableLabel)}` : ""}`;
      const base = `https://askrani.ai/s/${store.slug}`;
      const storeName = (store as { display_name?: string }).display_name || store.slug;
      const url = await createCheckoutSession(key, {
        amount,
        currency: ord.currency || "USD",
        ref: orderId,
        name: `${storeName} · Order ${orderId}`,
        metadata: { order_id: orderId, store: store.slug },
        successUrl: `${base}?${q}&paid=${encodeURIComponent(orderId)}`,
        cancelUrl: `${base}?${q}`,
      });
      if (!url) return json({ error: "couldn't start checkout" }, 502);
      return json({ payment_url: url });
    }
    // "Your usual" — this device's own past orders at this store (session_id is the
    // localStorage web_ id, so it's the guest's own history; no login, no cross-user
    // data). Returns re-orderable catalog lines incl. the exact modifier selection.
    case "history": {
      const { data: orders } = await db
        .from("orders")
        .select("order_id, timestamp, items_json, status")
        .eq("store_slug", store.slug)
        .eq("session_id", cartSession)
        .order("created_at", { ascending: false })
        .limit(6);
      // deno-lint-ignore no-explicit-any
      const recent = (orders ?? [])
        .filter((o) => o.status !== "cancelled" && o.status !== "rejected")
        // deno-lint-ignore no-explicit-any
        .map((o: any) => ({
          order_id: o.order_id,
          timestamp: o.timestamp,
          items: (Array.isArray(o.items_json) ? o.items_json : [])
            // deno-lint-ignore no-explicit-any
            .filter((it: any) => it && it.catalog_matched && it.sku)
            // deno-lint-ignore no-explicit-any
            .map((it: any) => ({
              sku: String(it.sku),
              name: String(it.name ?? ""),
              quantity: Number(it.quantity ?? 1),
              mod_sel: Array.isArray(it.mod_sel) ? it.mod_sel : null,
              // deno-lint-ignore no-explicit-any
              modifiers: Array.isArray(it.modifiers) ? it.modifiers.map((m: any) => String(m.option ?? "")) : [],
            })),
        }))
        .filter((o) => o.items.length > 0);
      return json({ orders: recent });
    }
    // Store-wide "Popular" — the most-ordered in-stock items (last 90 days).
    case "popular": {
      const showPrices = await maySeePrices(db, store, { sessionId });
      const { data, error } = await db.rpc("popular_products", {
        p_store_id: store.id,
        p_show_prices: showPrices,
        p_limit: 24,
      });
      if (error) {
        console.error(`[web-cart] popular: ${error.message}`);
        return json({ items: [] });
      }
      return json({ items: Array.isArray(data) ? data : [] });
    }
    // Share & earn — surfaces the store's LIVE give-and-get offer in the diner
    // surface (the engine is the same one the chat/WhatsApp bot uses). Describing
    // the offer needs no identity (anonymous-safe); a bound member session also
    // gets its credit balance + a real tracked referral link so a shared dish
    // attributes back. No campaign running → offer null, but sharing still works
    // as plain word-of-mouth on the diner side.
    case "rewards": {
      const { data: rule } = await db
        .from("reward_rules")
        .select(
          "campaign_id, amount_cents, recipient_amount_cents, recipient_min_order_cents, reward_campaigns!inner(status, store_id)",
        )
        .eq("trigger", "referral_first_order")
        .eq("reward_campaigns.store_id", store.id)
        .eq("reward_campaigns.status", "active")
        .limit(1)
        .maybeSingle();
      // deno-lint-ignore no-explicit-any
      const r = rule as any;
      const offer = r
        ? {
            friend_off_cents: Math.round(Number(r.recipient_amount_cents ?? 0)),
            you_get_cents: Math.round(Number(r.amount_cents ?? 0)),
            min_order_cents: Math.round(Number(r.recipient_min_order_cents ?? 0)),
          }
        : null;

      // A verified/bound session resolves to a member → real balance + link.
      const member = await resolveMember(db, store, sessionId);
      let balance_cents = 0;
      let link: string | null = null;
      if (member) {
        balance_cents = await rewardBalanceCents(db, store.id, member.id);
        if (r) {
          try {
            const rl = await getOrCreateReferralLink(db, {
              campaignId: r.campaign_id,
              initiatorMemberId: member.id,
            });
            link = trackedUrl(rl.code);
          } catch (e) {
            console.error(`[web-cart] rewards link: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      return json({ offer, identified: !!member, balance_cents, link });
    }
    default:
      return json({ error: `unknown action: ${action}` }, 400);
  }
});
