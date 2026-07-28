import "server-only";
import type { OrderForPush } from "./types";

/** One line as stored in orders.items_json (priced catalog line). */
type OrderItem = {
  sku?: string | null;
  base_sku?: string | null;
  name?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null; // dollars
  notes?: string | null;
  mod_sel?: { group: string; option: string }[] | null;
};

/** A provider-neutral priced line: our sku (for POS item mapping), name,
 *  integer quantity, unit price in cents. */
export type PricedLine = {
  sku: string | null;
  name: string;
  quantity: number;
  unitCents: number;
  note: string | null;
};

/**
 * Normalize an order's items into priced lines for a POS push. Unpriced/request
 * lines are skipped (no price to send); modifiers + notes fold into a line note.
 */
export function toPricedLines(order: OrderForPush): PricedLine[] {
  const items = Array.isArray(order.items_json) ? (order.items_json as OrderItem[]) : [];
  const out: PricedLine[] = [];
  for (const it of items) {
    const cents = it.unit_price == null ? null : Math.round(Number(it.unit_price) * 100);
    if (cents == null || !Number.isFinite(cents)) continue;
    const mods = (it.mod_sel ?? []).map((m) => `${m.group}: ${m.option}`).join(", ");
    const note = [mods, it.notes].filter(Boolean).join(" · ").slice(0, 500) || null;
    out.push({
      sku: it.sku ?? it.base_sku ?? null,
      name: (it.name ?? it.description ?? "Item").slice(0, 500),
      quantity: Math.max(1, Math.round(Number(it.quantity ?? 1))),
      unitCents: cents,
      note,
    });
  }
  return out;
}

/** A short ticket label for the kitchen: table, else customer, else order id. */
export function ticketName(order: OrderForPush): string {
  return (order.table_label || order.customer_name || order.order_id).slice(0, 30);
}
