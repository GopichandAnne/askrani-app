// Order placement — Bot Phase 3c (place_order). Turns a confirmed cart into a
// pending_approval order the panel picks up. The money is computed here in code
// from LIVE catalog prices re-fetched at confirm — the cart snapshot is never
// trusted for the finalized total, and an out-of-stock or re-priced item is
// never placed silently.
//
// The bot writes goods subtotal + tax (estimate); staff/owner add delivery/other
// charges and any discount in the Orders module to reach the final price.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { buildLine, type CartLine, clearCart, round2, viewCart } from "./cart.ts";
import { notifyResponders } from "./responders.ts";

export interface OrderTotals {
  subtotal: number;
  tax: number;
  total: number;
  /** true when at least one line has no price (staff prices it at confirm). */
  hasUnpriced: boolean;
}

/** Panel-identical: subtotal = Σ priced line_total, tax = subtotal×rate. Unpriced
 *  lines contribute 0 and flag hasUnpriced so the total is provisional. */
export function computeTotals(lines: CartLine[], taxRate: number): OrderTotals {
  let subtotal = 0;
  let hasUnpriced = false;
  for (const l of lines) {
    if (l.line_total == null) hasUnpriced = true;
    else subtotal += l.line_total;
  }
  subtotal = round2(subtotal);
  const tax = round2(subtotal * (taxRate || 0));
  const total = round2(subtotal + tax);
  return { subtotal, tax, total, hasUnpriced };
}

// ── Configurable charges & fees (percent of subtotal or flat $) ───────────────
export interface Charge {
  label: string;
  kind: "percent" | "flat";
  value: number;
  applies_to: "all" | "pickup" | "delivery";
}
export interface ChargedTotals {
  subtotal: number;
  charges: { label: string; amount: number }[];
  chargesTotal: number;
  total: number;
  hasUnpriced: boolean;
}

/** Apply a store's enabled charges to the subtotal for this fulfillment. Percent
 *  charges are % of subtotal; flat charges are a fixed dollar amount. */
export function computeCharged(
  lines: CartLine[],
  charges: Charge[],
  fulfillment: "pickup" | "delivery",
): ChargedTotals {
  let subtotal = 0;
  let hasUnpriced = false;
  for (const l of lines) {
    if (l.line_total == null) hasUnpriced = true;
    else subtotal += l.line_total;
  }
  subtotal = round2(subtotal);
  const applied: { label: string; amount: number }[] = [];
  for (const c of charges) {
    if (c.applies_to !== "all" && c.applies_to !== fulfillment) continue;
    const amount = c.kind === "flat" ? round2(Number(c.value) || 0) : round2(subtotal * (Number(c.value) || 0) / 100);
    if (amount) applied.push({ label: c.label, amount });
  }
  const chargesTotal = round2(applied.reduce((s, a) => s + a.amount, 0));
  const total = round2(subtotal + chargesTotal);
  return { subtotal, charges: applied, chargesTotal, total, hasUnpriced };
}

export async function loadCharges(db: SupabaseClient, storeId: string): Promise<Charge[]> {
  const { data } = await db
    .from("store_charges")
    .select("label, kind, value, applies_to")
    .eq("store_id", storeId)
    .eq("enabled", true)
    .order("sort", { ascending: true });
  return (data ?? []) as Charge[];
}

/** Map a cart line to the panel's items_json shape: a priced catalog line ->
 *  CatalogItem; a request item OR an unpriced catalog line -> RequestItem (which
 *  staff price in the Orders module). Notes carry through. */
function toOrderItem(l: CartLine): Record<string, unknown> {
  if (!l.request && l.unit_price != null && l.line_total != null) {
    return {
      sku: l.sku, catalog_matched: true, name: l.name, brand: l.brand,
      size: l.size, unit: l.unit, quantity: l.quantity, notes: l.notes,
      unit_price: l.unit_price, line_total: l.line_total,
    };
  }
  const desc = [l.name, [l.size, l.unit].filter(Boolean).join(" ")].filter(Boolean).join(" ");
  return {
    sku: "", item_id: crypto.randomUUID(), catalog_matched: false,
    description: desc, name: l.name, brand: l.brand, size: l.size, unit: l.unit,
    quantity: l.quantity, notes: l.notes, unit_price: null, line_total: null,
  };
}

export async function loadTaxRate(db: SupabaseClient, storeId: string): Promise<number> {
  const { data } = await db
    .from("agent_config")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "tax_rate")
    .maybeSingle();
  const r = Number.parseFloat(data?.value ?? "");
  return Number.isFinite(r) && r >= 0 ? r : 0;
}

/** order_id prefix from the slug: initials of hyphen segments, else first chars. */
export function deriveOrderPrefix(slug: string): string {
  const segs = slug.split("-").filter(Boolean);
  const initials = segs.map((s) => s[0]).join("").toUpperCase();
  if (initials.length >= 2) return initials;
  return slug.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "ORD";
}

async function nextOrderId(db: SupabaseClient, store: Store): Promise<string> {
  const year = new Date().getUTCFullYear();
  const { data, error } = await db.rpc("next_order_seq", {
    p_store_slug: store.slug,
    p_year: year,
  });
  if (error || data == null) throw new Error(`order seq: ${error?.message ?? "null"}`);
  return `${deriveOrderPrefix(store.slug)}-${year}-${String(Number(data)).padStart(4, "0")}`;
}

async function emitOrderCreated(
  db: SupabaseClient,
  store: Store,
  customerPhone: string,
  orderId: string,
  totals: OrderTotals,
  itemCount: number,
): Promise<void> {
  const threadId = `thr_${customerPhone}_${store.slug}`;
  // The webhook already created the thread on inbound; upsert defensively.
  await db.from("threads").upsert(
    { thread_id: threadId, store_slug: store.slug, customer_phone: customerPhone },
    { onConflict: "thread_id", ignoreDuplicates: true },
  );
  const { error } = await db.from("thread_messages").insert({
    message_id: `evt_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: customerPhone,
    direction: "system",
    sender: "bot",
    kind: "event",
    event_type: "order_created",
    related_order_id: orderId,
    text: `Order ${orderId} placed via WhatsApp — ${itemCount} item(s), total $${totals.total.toFixed(2)}`,
    event_payload_json: { order_id: orderId, ...totals },
  });
  if (error) console.error(`[order] event ${orderId}: ${error.message}`);
}

/**
 * Finalize the session's cart into a pending_approval order. Called only after
 * the customer's explicit yes (the model gates that; confirmationText is the
 * verbatim affirmative). Re-validates every line against LIVE stock/price at
 * this moment — aborts (creating nothing) on out-of-stock or price drift.
 */
export async function placeOrder(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  fulfillment: "pickup" | "delivery",
  confirmationText: string,
): Promise<Record<string, unknown>> {
  if (!confirmationText.trim()) return { placed: false, reason: "no_confirmation" };

  const lines = await viewCart(db, sessionId);
  if (lines.length === 0) return { placed: false, reason: "empty_cart" };

  // ── Fresh LIVE re-validation of CATALOG lines (never the cart snapshot).
  //    Request items have no sku to check — they pass through unpriced. ─────────
  const catalogLines = lines.filter((l) => !l.request);
  const requestLines = lines.filter((l) => l.request);

  const { data: live } = await db
    .from("products")
    .select("sku, name, brand, size, unit, price, in_stock")
    .eq("store_id", store.id)
    .in("sku", catalogLines.map((l) => l.sku));
  const bySku = new Map((live ?? []).map((p) => [p.sku, p]));

  const outOfStock: string[] = [];
  const priceChanges: { name: string; was: number; now: number }[] = [];
  const revalidated: CartLine[] = [];
  for (const line of catalogLines) {
    const p = bySku.get(line.sku);
    if (!p || !p.in_stock) {
      outOfStock.push(line.name); // stock is checked for every catalog item
      continue;
    }
    // Surface a price change only for an item the customer was quoted a price for.
    if (line.unit_price != null && p.price != null && round2(p.price) !== round2(line.unit_price)) {
      priceChanges.push({ name: line.name, was: line.unit_price, now: p.price });
    }
    revalidated.push(buildLine(p as Parameters<typeof buildLine>[0], line.quantity, line.notes));
  }
  if (outOfStock.length > 0) return { placed: false, reason: "out_of_stock", items: outOfStock };
  if (priceChanges.length > 0) return { placed: false, reason: "price_changed", changes: priceChanges };
  revalidated.push(...requestLines); // unpriced request items pass through

  // ── Totals from LIVE prices (priced lines); apply the store's charges & fees ──
  const charges = await loadCharges(db, store.id);
  const charged = computeCharged(revalidated, charges, fulfillment);
  // Legacy shape: total = subtotal + tax, where tax now holds the charges total.
  const totals = {
    subtotal: charged.subtotal,
    tax: charged.chargesTotal,
    total: charged.total,
    hasUnpriced: charged.hasUnpriced,
  };
  const itemsJson = revalidated.map(toOrderItem);
  const orderMode = revalidated.some((l) => l.unit_price == null) ? "request" : "standard";
  const customerPhone = sessionId.startsWith("wa_") ? sessionId.slice(3) : sessionId;

  let orderId: string;
  try {
    orderId = await nextOrderId(db, store);
  } catch (e) {
    return { placed: false, reason: "db_error", detail: e instanceof Error ? e.message : String(e) };
  }

  const { data: thread } = await db
    .from("threads")
    .select("customer_name")
    .eq("thread_id", `thr_${customerPhone}_${store.slug}`)
    .maybeSingle();

  const { error } = await db.from("orders").insert({
    order_id: orderId,
    store_slug: store.slug,
    customer_phone: customerPhone,
    customer_name: thread?.customer_name ?? null,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    items_json: itemsJson,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    charges_json: charged.charges,
    currency: "USD",
    fulfillment,
    status: "pending_approval",
    // Was hardcoded "whatsapp", so every web order lied about where it came from.
    source_channel: sessionId.startsWith("web_") ? "web" : "whatsapp",
    order_mode: orderMode,
  });
  if (error) return { placed: false, reason: "db_error", detail: error.message };

  await emitOrderCreated(db, store, customerPhone, orderId, totals, revalidated.length);
  await clearCart(db, store, sessionId); // one-way: cart -> order

  // DM responders who opted into order alerts.
  const totalLabel = totals.hasUnpriced ? `$${totals.total} + items to price` : `$${totals.total}`;
  await notifyResponders(
    db, store, "order",
    `New WhatsApp order ${orderId} (${fulfillment}) from ${thread?.customer_name ?? customerPhone}: ${revalidated.length} item(s), ${totalLabel}. Review in the panel.`,
  );

  return {
    placed: true,
    order_id: orderId,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    has_unpriced: totals.hasUnpriced,
    fulfillment,
    items: revalidated.length,
  };
}

// ── Proposal-acceptance loop ──────────────────────────────────────────────────
// After the owner prices/approves an order in the panel (status -> proposed) and
// it is sent to the customer, the customer's reply comes back here.

async function emitOrderEvent(
  db: SupabaseClient,
  store: Store,
  customerPhone: string,
  orderId: string,
  eventType: string,
  text: string,
): Promise<void> {
  const threadId = `thr_${customerPhone}_${store.slug}`;
  await db.from("thread_messages").insert({
    message_id: `evt_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: customerPhone,
    direction: "system",
    sender: "customer",
    kind: "event",
    event_type: eventType,
    related_order_id: orderId,
    text,
  }).then(({ error }) => { if (error) console.error(`[order] event ${orderId}: ${error.message}`); });
}

/** Orders currently proposed to (awaiting a decision from) this session. */
export async function getPendingProposals(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
): Promise<{ order_id: string; total: number | null }[]> {
  const { data } = await db
    .from("orders")
    .select("order_id, total")
    .eq("store_slug", store.slug)
    .eq("session_id", sessionId)
    .eq("status", "proposed");
  return (data ?? []).map((o) => ({ order_id: o.order_id, total: o.total }));
}

async function loadOwnProposal(db: SupabaseClient, store: Store, sessionId: string, orderId: string) {
  const { data } = await db
    .from("orders")
    .select("status, session_id, total")
    .eq("order_id", orderId)
    .eq("store_slug", store.slug)
    .maybeSingle();
  if (!data) return { err: "not_found" as const };
  if (data.session_id !== sessionId) return { err: "not_your_order" as const };
  return { order: data };
}

export async function confirmProposedOrder(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  orderId: string,
): Promise<Record<string, unknown>> {
  const r = await loadOwnProposal(db, store, sessionId, orderId);
  if ("err" in r) return { ok: false, reason: r.err };
  if (r.order.status !== "proposed") return { ok: false, reason: `not_proposed (${r.order.status})` };

  const { error } = await db.from("orders").update({ status: "confirmed" }).eq("order_id", orderId);
  if (error) return { ok: false, reason: "db_error" };
  const phone = sessionId.startsWith("wa_") ? sessionId.slice(3) : sessionId;
  await emitOrderEvent(db, store, phone, orderId, "order_confirmed", `Order ${orderId} confirmed by customer`);
  return { ok: true, order_id: orderId, total: r.order.total };
}

export async function cancelProposedOrder(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  orderId: string,
  reason: string,
): Promise<Record<string, unknown>> {
  const r = await loadOwnProposal(db, store, sessionId, orderId);
  if ("err" in r) return { ok: false, reason: r.err };
  // Only pre-confirmation orders auto-cancel; a confirmed order needs the owner.
  if (!["proposed", "submitted", "pending_approval", "placed"].includes(r.order.status)) {
    return { ok: false, reason: "needs_owner", status: r.order.status };
  }
  const { error } = await db.from("orders").update({ status: "cancelled" }).eq("order_id", orderId);
  if (error) return { ok: false, reason: "db_error" };
  const phone = sessionId.startsWith("wa_") ? sessionId.slice(3) : sessionId;
  await emitOrderEvent(db, store, phone, orderId, "order_cancelled", `Order ${orderId} cancelled by customer: ${reason}`);
  return { ok: true, order_id: orderId };
}
