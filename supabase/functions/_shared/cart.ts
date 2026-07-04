// Postgres cart — Bot Phase 3c. One cart per session (carts table, keyed by
// session_id). The cart holds real catalog items resolved by sku; a line's
// unit_price is snapshotted from the LIVE catalog at add-time.
//
// Pricing is OPTIONAL: an owner may leave items unpriced. An unpriced line has
// unit_price = null (never a guessed number) — the store team sets the price
// when they confirm the order. place_order re-validates against live data at
// confirm; these add-time values are for the running display only.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";

/** Internal cart line: always a real catalog product (has sku), price optional. */
export interface CartLine {
  sku: string;
  name: string;
  brand: string | null;
  size: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number | null; // null = unpriced (staff prices at confirm)
  line_total: number | null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sum of priced lines only; unpriced lines contribute nothing to the running subtotal. */
export function cartSubtotal(lines: CartLine[]): number {
  return round2(lines.reduce((s, l) => s + (l.line_total ?? 0), 0));
}

/** Snapshot a catalog row into a cart line. price may be null (unpriced item). */
export function buildLine(
  p: { sku: string; name: string; brand: string | null; size: string | null; unit: string | null; price: number | null },
  quantity: number,
): CartLine {
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    size: p.size,
    unit: p.unit,
    quantity,
    unit_price: p.price,
    line_total: p.price == null ? null : round2(p.price * quantity),
  };
}

export type AddStatus = "added" | "removed" | "not_found" | "out_of_stock";

async function readLines(db: SupabaseClient, sessionId: string): Promise<CartLine[]> {
  const { data } = await db.from("carts").select("items").eq("session_id", sessionId).maybeSingle();
  return Array.isArray(data?.items) ? (data!.items as CartLine[]) : [];
}

async function writeLines(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  lines: CartLine[],
): Promise<void> {
  const { error } = await db.from("carts").upsert(
    {
      session_id: sessionId,
      store_slug: store.slug,
      items: lines,
      subtotal: cartSubtotal(lines),
      currency: "USD",
    },
    { onConflict: "session_id" },
  );
  if (error) console.error(`[cart] save ${sessionId}: ${error.message}`);
}

/**
 * Set an item's quantity in the cart (idempotent, not increment). quantity <= 0
 * removes it. Resolves by exact sku against the LIVE catalog; refuses unknown or
 * out-of-stock items. An item with no catalog price is still added (unpriced) —
 * the price is never invented.
 */
export async function addToCart(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  sku: string,
  quantity: number,
): Promise<{ status: AddStatus; name?: string; lines: CartLine[] }> {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const lines = await readLines(db, sessionId);

  if (qty === 0) {
    const next = lines.filter((l) => l.sku !== sku);
    await writeLines(db, store, sessionId, next);
    return { status: "removed", lines: next };
  }

  const { data: p } = await db
    .from("products")
    .select("sku, name, brand, size, unit, price, in_stock")
    .eq("store_id", store.id)
    .eq("sku", sku)
    .maybeSingle();
  if (!p) return { status: "not_found", lines };
  if (!p.in_stock) return { status: "out_of_stock", name: p.name, lines };

  const line = buildLine(p as Parameters<typeof buildLine>[0], qty);
  const idx = lines.findIndex((l) => l.sku === sku);
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  await writeLines(db, store, sessionId, lines);
  return { status: "added", name: p.name, lines };
}

export async function removeFromCart(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  sku: string,
): Promise<{ removed: boolean; lines: CartLine[] }> {
  const lines = await readLines(db, sessionId);
  const next = lines.filter((l) => l.sku !== sku);
  await writeLines(db, store, sessionId, next);
  return { removed: next.length !== lines.length, lines: next };
}

export async function clearCart(db: SupabaseClient, store: Store, sessionId: string): Promise<void> {
  await writeLines(db, store, sessionId, []);
}

export async function viewCart(db: SupabaseClient, sessionId: string): Promise<CartLine[]> {
  return await readLines(db, sessionId);
}
