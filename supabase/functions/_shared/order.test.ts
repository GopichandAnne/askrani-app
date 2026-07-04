// Deno tests for pure order math (no DB). Run:
//   deno test supabase/functions/_shared/order.test.ts

import { assertEquals } from "jsr:@std/assert@1";
import { buildLine } from "./cart.ts";
import { computeTotals, deriveOrderPrefix } from "./order.ts";

const line = (sku: string, price: number, qty: number) =>
  buildLine({ sku, name: sku, brand: null, size: null, unit: null, price }, qty);

const unpricedLine = (sku: string, qty: number) =>
  buildLine({ sku, name: sku, brand: null, size: null, unit: null, price: null }, qty);

Deno.test("computeTotals: subtotal + tax (0.0825), panel-identical", () => {
  const lines = [line("A", 2.49, 2), line("B", 18.99, 1)]; // 4.98 + 18.99 = 23.97
  const t = computeTotals(lines, 0.0825);
  assertEquals(t.subtotal, 23.97);
  assertEquals(t.tax, 1.98); // round2(23.97 * 0.0825) = 1.9775 -> 1.98
  assertEquals(t.total, 25.95);
  assertEquals(t.hasUnpriced, false);
});

Deno.test("computeTotals: zero tax rate", () => {
  const t = computeTotals([line("A", 6.99, 3)], 0); // 20.97
  assertEquals(t, { subtotal: 20.97, tax: 0, total: 20.97, hasUnpriced: false });
});

Deno.test("computeTotals: empty", () => {
  assertEquals(computeTotals([], 0.0825), { subtotal: 0, tax: 0, total: 0, hasUnpriced: false });
});

Deno.test("computeTotals: unpriced lines flag hasUnpriced and add 0", () => {
  const t = computeTotals([line("A", 2.49, 2), unpricedLine("B", 3)], 0.0825);
  assertEquals(t.subtotal, 4.98); // only the priced line
  assertEquals(t.hasUnpriced, true);
});

Deno.test("deriveOrderPrefix: hyphen-segment initials", () => {
  assertEquals(deriveOrderPrefix("man-pasand-lakeline"), "MPL");
  assertEquals(deriveOrderPrefix("green-grocer"), "GG");
});

Deno.test("deriveOrderPrefix: single-word slug falls back to first chars", () => {
  assertEquals(deriveOrderPrefix("bazaar"), "BAZ");
});
