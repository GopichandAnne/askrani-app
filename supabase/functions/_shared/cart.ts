// Postgres cart — Bot Phase 3c/3d. One cart per session (carts table, keyed by
// session_id). Two kinds of line:
//   - catalog item: resolved by real sku; price snapshotted from the live catalog
//     (may be null = unpriced, staff prices at confirm).
//   - request item: something NOT cleanly in the catalog (fresh produce, a
//     weight request, an unusual item). Keyed by a generated "req_<id>" sku,
//     always unpriced — the store team sources and prices it.
//
// Money-safety: a price is NEVER invented. place_order re-validates catalog
// lines against live data at confirm; these values are for the running display.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";

export interface CartLine {
  sku: string; // real catalog sku, or "req_<id>" for a request item
  request: boolean; // true = non-catalog item the store sources/prices
  name: string; // product name, or the customer's description
  brand: string | null;
  size: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number | null; // null = unpriced
  line_total: number | null;
  notes: string | null; // customer preference: "ripe ones", "small pack"
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sum of priced lines only; unpriced/request lines contribute nothing. */
export function cartSubtotal(lines: CartLine[]): number {
  return round2(lines.reduce((s, l) => s + (l.line_total ?? 0), 0));
}

/** Snapshot a catalog row into a cart line. price may be null (unpriced item). */
export function buildLine(
  p: { sku: string; name: string; brand: string | null; size: string | null; unit: string | null; price: number | null },
  quantity: number,
  notes: string | null = null,
): CartLine {
  return {
    sku: p.sku,
    request: false,
    name: p.name,
    brand: p.brand,
    size: p.size,
    unit: p.unit,
    quantity,
    unit_price: p.price,
    line_total: p.price == null ? null : round2(p.price * quantity),
    notes,
  };
}

export type AddStatus = "added" | "removed" | "not_found" | "out_of_stock";

async function readLines(db: SupabaseClient, sessionId: string): Promise<CartLine[]> {
  const { data } = await db.from("carts").select("items").eq("session_id", sessionId).maybeSingle();
  return Array.isArray(data?.items) ? (data!.items as CartLine[]) : [];
}

async function writeLines(db: SupabaseClient, store: Store, sessionId: string, lines: CartLine[]): Promise<void> {
  const { error } = await db.from("carts").upsert(
    { session_id: sessionId, store_slug: store.slug, items: lines, subtotal: cartSubtotal(lines), currency: "USD" },
    { onConflict: "session_id" },
  );
  if (error) console.error(`[cart] save ${sessionId}: ${error.message}`);
}

/** Set a catalog item's quantity (idempotent). quantity <= 0 removes it. */
export async function addToCart(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  sku: string,
  quantity: number,
  notes: string | null = null,
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

  const idx = lines.findIndex((l) => l.sku === sku);
  const keepNotes = notes ?? (idx >= 0 ? lines[idx].notes : null);
  const line = buildLine(p as Parameters<typeof buildLine>[0], qty, keepNotes);
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  await writeLines(db, store, sessionId, lines);
  return { status: "added", name: p.name, lines };
}

/** Add a non-catalog request item (fresh produce, a weight request, unusual
 *  item). Always unpriced — the store sources and prices it. */
export async function addRequestItem(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  description: string,
  quantity: number,
  notes: string | null = null,
): Promise<{ status: "added"; name: string; lines: CartLine[] }> {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const lines = await readLines(db, sessionId);
  const line: CartLine = {
    sku: `req_${crypto.randomUUID().slice(0, 8)}`,
    request: true,
    name: description,
    brand: null,
    size: null,
    unit: null,
    quantity: qty,
    unit_price: null,
    line_total: null,
    notes,
  };
  lines.push(line);
  await writeLines(db, store, sessionId, lines);
  return { status: "added", name: description, lines };
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
