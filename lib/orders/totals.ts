import type { OrderItem } from "@/lib/orders/types";

/** Round to 2 decimals without binary-float drift. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** line_total for one item; null when a request item is not yet priced. */
export function lineTotal(item: OrderItem): number | null {
  if (item.unit_price == null) return null;
  return round2(item.unit_price * (item.quantity ?? 0));
}

export type OrderTotals = {
  subtotal: number;
  tax: number;
  total: number;
  /** true when at least one item is missing a price (request items). */
  hasUnpriced: boolean;
};

/**
 * Recompute subtotal/tax/total from items and the store tax rate. Unpriced
 * request items contribute 0 and flag `hasUnpriced` so the UI can warn before
 * proposing/confirming. Mirrors the editOrder math in Orders.gs.
 */
export function computeTotals(
  items: OrderItem[],
  taxRate: number,
): OrderTotals {
  let subtotal = 0;
  let hasUnpriced = false;
  for (const item of items) {
    const lt = lineTotal(item);
    if (lt == null) {
      hasUnpriced = true;
      continue;
    }
    subtotal += lt;
  }
  subtotal = round2(subtotal);
  const tax = round2(subtotal * (taxRate || 0));
  const total = round2(subtotal + tax);
  return { subtotal, tax, total, hasUnpriced };
}

export function formatMoney(
  amount: number | null | undefined,
  currency = "USD",
): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}
