// Deno tests for the pure cart math (no DB). Run:
//   deno test supabase/functions/_shared/cart.test.ts

import { assertEquals } from "jsr:@std/assert@1";
import { buildLine, type CartLine, cartSubtotal, round2 } from "./cart.ts";

const P = (over: Partial<Parameters<typeof buildLine>[0]> = {}) => ({
  sku: "MP-0001", name: "Toor Dal", brand: "Swad", size: "4", unit: "lb", price: 6.99,
  ...over,
});

Deno.test("round2 avoids float drift", () => {
  assertEquals(round2(2.49 * 3), 7.47);
  assertEquals(round2(0.1 + 0.2), 0.3);
});

Deno.test("buildLine snapshots price and computes line_total in code", () => {
  const l = buildLine(P(), 3);
  assertEquals(l.sku, "MP-0001");
  assertEquals(l.catalog_matched, true);
  assertEquals(l.unit_price, 6.99);
  assertEquals(l.quantity, 3);
  assertEquals(l.line_total, 20.97);
});

Deno.test("cartSubtotal sums line totals (rounded)", () => {
  const lines: CartLine[] = [
    buildLine(P({ sku: "A", price: 2.49 }), 2), // 4.98
    buildLine(P({ sku: "B", price: 18.99 }), 1), // 18.99
    buildLine(P({ sku: "C", price: 1.79 }), 3), // 5.37
  ];
  assertEquals(cartSubtotal(lines), 29.34);
});

Deno.test("cartSubtotal of empty cart is 0", () => {
  assertEquals(cartSubtotal([]), 0);
});
