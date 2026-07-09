// Tests for the silence check-back's goodbye heuristic (pure — no DB/key).
//   deno test supabase/functions/_shared/followup.test.ts

import { assert } from "jsr:@std/assert@1";
import { isLikelyClosing } from "./followup.ts";

Deno.test("isLikelyClosing: catches farewells and pure-thanks closers", () => {
  for (const t of [
    "bye",
    "Goodbye!",
    "good night",
    "thanks",
    "thank you",
    "ok",
    "no thanks",
    "that's all",
    "I'm good",
    "see you",
    "👍",
    "take care",
  ]) {
    assert(isLikelyClosing(t), `expected closing: ${t}`);
  }
});

Deno.test("isLikelyClosing: does NOT fire on real questions / ongoing chat", () => {
  for (const t of [
    "do you have basmati rice?",
    "how much is delivery?",
    "can you add 2 kg onions",
    "what time do you open tomorrow?",
    "thanks, and do you have paneer too?", // thanks + a new request → still active
    "",
  ]) {
    assert(!isLikelyClosing(t), `expected NOT closing: ${t}`);
  }
});
