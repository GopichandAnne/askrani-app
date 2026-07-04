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

export interface OrderTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/** Panel-identical: subtotal = Σ line_total, tax = subtotal×rate, total = sum. */
export function computeTotals(lines: CartLine[], taxRate: number): OrderTotals {
  const subtotal = round2(lines.reduce((s, l) => s + (l.line_total ?? 0), 0));
  const tax = round2(subtotal * (taxRate || 0));
  const total = round2(subtotal + tax);
  return { subtotal, tax, total };
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

  // ── Fresh LIVE re-validation (never the cart snapshot) ──────────────────────
  const { data: live } = await db
    .from("products")
    .select("sku, name, brand, size, unit, price, in_stock")
    .eq("store_id", store.id)
    .in("sku", lines.map((l) => l.sku));
  const bySku = new Map((live ?? []).map((p) => [p.sku, p]));

  const outOfStock: string[] = [];
  const priceChanges: { name: string; was: number; now: number }[] = [];
  const revalidated: CartLine[] = [];
  for (const line of lines) {
    const p = bySku.get(line.sku);
    if (!p || !p.in_stock || p.price == null) {
      outOfStock.push(line.name);
      continue;
    }
    if (round2(p.price) !== round2(line.unit_price)) {
      priceChanges.push({ name: line.name, was: line.unit_price, now: p.price });
    }
    revalidated.push(buildLine(p as Parameters<typeof buildLine>[0], line.quantity));
  }
  if (outOfStock.length > 0) return { placed: false, reason: "out_of_stock", items: outOfStock };
  if (priceChanges.length > 0) return { placed: false, reason: "price_changed", changes: priceChanges };

  // ── Totals from LIVE prices; write the order the panel expects ──────────────
  const taxRate = await loadTaxRate(db, store.id);
  const totals = computeTotals(revalidated, taxRate);
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
    items_json: revalidated,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    currency: "USD",
    fulfillment,
    status: "pending_approval",
    source_channel: "whatsapp",
    order_mode: "standard",
  });
  if (error) return { placed: false, reason: "db_error", detail: error.message };

  await emitOrderCreated(db, store, customerPhone, orderId, totals, revalidated.length);
  await clearCart(db, store, sessionId); // one-way: cart -> order

  return {
    placed: true,
    order_id: orderId,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    fulfillment,
    items: revalidated.length,
  };
}
