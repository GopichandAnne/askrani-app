// Postgres cart — Bot Phase 3c (cart slice). One cart per session (carts table,
// keyed by session_id). Lines are CatalogItem-shaped so place_order can copy
// them straight into orders.items_json and the panel parses them unchanged.
//
// Money-safety: a line's unit_price is snapshotted from the LIVE catalog at
// add-time (never model-supplied), and line_total/subtotal are computed here in
// code. place_order (next slice) RE-validates against live catalog at confirm —
// these add-time values are for the running display only, never the final total.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";

/** Mirrors lib/orders/types.ts CatalogItem (the panel's line shape). */
export interface CartLine {
  sku: string;
  catalog_matched: true;
  name: string;
  brand: string | null;
  size: string | null;
  unit: string | null;
  quantity: number;
  notes: string | null;
  unit_price: number;
  line_total: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function cartSubtotal(lines: CartLine[]): number {
  return round2(lines.reduce((s, l) => s + (l.line_total ?? 0), 0));
}

/** Snapshot a catalog row into a cart line (price captured now, in code). */
export function buildLine(
  p: { sku: string; name: string; brand: string | null; size: string | null; unit: string | null; price: number },
  quantity: number,
): CartLine {
  return {
    sku: p.sku,
    catalog_matched: true,
    name: p.name,
    brand: p.brand,
    size: p.size,
    unit: p.unit,
    quantity,
    notes: null,
    unit_price: p.price,
    line_total: round2(p.price * quantity),
  };
}

export type AddStatus = "added" | "removed" | "not_found" | "out_of_stock" | "no_price";

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
 * Set an item's quantity in the cart (not increment — idempotent, retry-safe).
 * quantity <= 0 removes the line. Resolves by exact sku against the LIVE catalog;
 * refuses out-of-stock / unpriced / unknown items so only real, in-stock,
 * priced products enter the cart.
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
  if (p.price == null) return { status: "no_price", name: p.name, lines };

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

export async function clearCart(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
): Promise<void> {
  await writeLines(db, store, sessionId, []);
}

export async function viewCart(db: SupabaseClient, sessionId: string): Promise<CartLine[]> {
  return await readLines(db, sessionId);
}
