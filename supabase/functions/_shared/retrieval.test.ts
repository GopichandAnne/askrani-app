// Deno tests for the pure retrieval helpers (no key, no DB, no network). Run:
//   deno test supabase/functions/_shared/retrieval.test.ts

import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { EMBED_DIM, l2normalize, toVectorLiteral } from "./embeddings.ts";
import { productEmbedText } from "./tools.ts";
import { chunkText, estimateTokens } from "./knowledge.ts";

Deno.test("l2normalize -> unit length", () => {
  const v = l2normalize([3, 4]); // |[3,4]| = 5
  assertAlmostEquals(v[0], 0.6, 1e-9);
  assertAlmostEquals(v[1], 0.8, 1e-9);
  const mag = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  assertAlmostEquals(mag, 1, 1e-9);
});

Deno.test("l2normalize handles the zero vector without NaN", () => {
  assertEquals(l2normalize([0, 0, 0]), [0, 0, 0]);
});

Deno.test("toVectorLiteral -> pgvector text form", () => {
  assertEquals(toVectorLiteral([0.1, 0.2, -0.3]), "[0.1,0.2,-0.3]");
});

Deno.test("EMBED_DIM is 768 (matches vector(768) column)", () => {
  assertEquals(EMBED_DIM, 768);
});

Deno.test("productEmbedText: descriptive, joins present fields, drops empties", () => {
  const t = productEmbedText({
    name: "Methi (Fenugreek Leaves)",
    brand: "Deep",
    category: "Frozen",
    size: "340",
    unit: "g",
  });
  assertEquals(t, "Methi (Fenugreek Leaves) · Deep · Frozen · 340 g");
});

Deno.test("productEmbedText: name-only product", () => {
  assertEquals(
    productEmbedText({ name: "Toor Dal", brand: null, category: null, size: null, unit: null }),
    "Toor Dal",
  );
});

Deno.test("chunkText: short text -> single chunk", () => {
  assertEquals(chunkText("We deliver within 5 miles."), ["We deliver within 5 miles."]);
  assertEquals(chunkText("   "), []);
});

Deno.test("chunkText: long text -> overlapping chunks, all within budget", () => {
  const para = "This is a sentence about store policy. ".repeat(60); // ~2280 chars
  const text = [para, para, para].join("\n\n"); // ~6.8k chars
  const chunks = chunkText(text, 3000, 400);
  assert(chunks.length >= 2, "should split");
  for (const c of chunks) assert(c.length <= 3000, `chunk over budget: ${c.length}`);
  // overlap: end of chunk[0] should reappear at the start region of chunk[1]
  const tail = chunks[0].slice(-100).trim();
  assert(chunks[1].includes(tail.slice(0, 40)), "expected overlap between chunks");
});

Deno.test("chunkText: a single oversized paragraph still terminates and covers", () => {
  const big = "word ".repeat(2000); // ~10k chars, no paragraph breaks
  const chunks = chunkText(big, 3000, 400);
  assert(chunks.length >= 3);
  for (const c of chunks) assert(c.length <= 3000);
});

Deno.test("estimateTokens ~ chars/4", () => {
  assertEquals(estimateTokens("abcd"), 1);
  assertEquals(estimateTokens("abcde"), 2);
});
