// deno test supabase/functions/_shared/audit.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { actedAsLabel } from "./audit.ts";

Deno.test("actedAsLabel: only identity tools attribute to a customer", () => {
  // Store-level auth = acted as the store, never a customer.
  assertEquals(actedAsLabel("none", { email: "a@b.com" }), null);
  assertEquals(actedAsLabel("apikey", { email: "a@b.com" }), null);
  assertEquals(actedAsLabel("oauth", { sub: "u1" }), null);
});

Deno.test("actedAsLabel: identity tools prefer email > sub > phone", () => {
  assertEquals(actedAsLabel("identity", { email: "a@b.com", sub: "u1", phone: "+1" }), "a@b.com");
  assertEquals(actedAsLabel("identity", { sub: "u1", phone: "+1" }), "u1");
  assertEquals(actedAsLabel("identity", { phone: "+1" }), "+1");
});

Deno.test("actedAsLabel: identity with no visitor still records a signed-in customer, never a token", () => {
  assertEquals(actedAsLabel("identity", undefined), "signed-in customer");
  assertEquals(actedAsLabel("identity", { token: "secret-tok" }), "signed-in customer");
});
