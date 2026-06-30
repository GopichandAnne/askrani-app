// Deno test for the Gemini no-key guard. Run:
//   deno test --allow-env supabase/functions/_shared/gemini.test.ts
//
// Proves the bot is safe to run/deploy before GEMINI_API_KEY is set: with no
// key, generateReply() returns { text: null } WITHOUT a network call, so the
// webhook just persists the inbound and stays quiet.

import { assertEquals } from "jsr:@std/assert@1";
import { generateReply } from "./gemini.ts";

Deno.test("generateReply with no GEMINI_API_KEY -> { text: null }, no network", async () => {
  Deno.env.delete("GEMINI_API_KEY");
  const res = await generateReply("system", [
    { role: "user", parts: [{ text: "hi" }] },
  ]);
  assertEquals(res.text, null);
});
