// Deno tests for the conversation prompt assembly. Run:
//   deno test supabase/functions/_shared/prompt.test.ts
//
// No key, no DB — these assert the pure assembly/shaping/gate/language logic,
// and in particular the CACHEABILITY contract: the system instruction is stable
// across turns and the new message is always appended last so the prefix holds.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type AgentConfig,
  buildContents,
  buildSystemInstruction,
  type Content,
  detectLanguage,
  shapeHistory,
  shouldBotRespond,
} from "./prompt.ts";

function cfg(over: Partial<AgentConfig> = {}): AgentConfig {
  return {
    storeName: "Man Pasand",
    businessType: "grocery",
    personality: "Friendly and concise.",
    offTopicHandling: "Politely steer back to shopping.",
    languageHandling: "Match the customer's language.",
    engageInfo: "Offer to build a cart.",
    storePrompt: "We carry South Asian groceries.",
    historyTurns: 10,
    orderPrompt: null,
    promotions: null,
    ordersEnabled: false,
    timezone: "America/Chicago",
    storeHours: null,
    catalogEnabled: true,
    ...over,
  };
}

Deno.test("system instruction includes store + config", () => {
  const s = buildSystemInstruction(cfg());
  assert(s.includes("Man Pasand"));
  assert(s.includes("grocery"));
  assert(s.includes("Friendly and concise."));
  assert(s.includes("We carry South Asian groceries."));
});

Deno.test("system instruction has NO knowledge in the prefix (retrieval-on-demand)", () => {
  // KB/products are fetched via tools now, never baked into the cached prefix.
  const s = buildSystemInstruction(cfg());
  assert(!s.includes("## Knowledge base"));
  assert(!s.includes("Q:"));
});

Deno.test("request mode: no-price rule present, catalogue rule absent", () => {
  const req = buildSystemInstruction(cfg({ catalogEnabled: false }));
  assert(req.includes("no price list"));
  assert(!req.includes("MUST call search_products"));

  const cat = buildSystemInstruction(cfg({ catalogEnabled: true }));
  assert(cat.includes("MUST call search_products"));
  assert(!cat.includes("no price list"));
});

Deno.test("ordering rules + order prompt appear ONLY when ordersEnabled", () => {
  const off = buildSystemInstruction(cfg({ ordersEnabled: false, orderPrompt: "Pickup only." }));
  assert(!off.includes("place_order"));
  assert(!off.includes("## Ordering"));

  const on = buildSystemInstruction(cfg({ ordersEnabled: true, orderPrompt: "Pickup only." }));
  assert(on.includes("place_order"));
  assert(on.includes("## Ordering"));
  assert(on.includes("Pickup only."));
});

Deno.test("promotions section appears only when set, with guardrails", () => {
  const off = buildSystemInstruction(cfg({ promotions: null }));
  assert(!off.includes("## Promotions"));

  const on = buildSystemInstruction(cfg({ promotions: "Weekend sweets combo: buy 2 boxes." }));
  assert(on.includes("## Promotions"));
  assert(on.includes("Weekend sweets combo: buy 2 boxes."));
  // Guardrail wording travels with the section.
  assert(on.includes("sparingly"));
});

Deno.test("conversational-flow + proactive-image rules are always present", () => {
  const s = buildSystemInstruction(cfg());
  assert(s.includes("Talk like a helpful person, not a form"));
  assert(s.includes("on your own initiative")); // proactive send_image
});

Deno.test("system instruction omits empty sections (stays stable)", () => {
  const s = buildSystemInstruction(cfg({ personality: null, engageInfo: null }));
  assert(!s.includes("## Personality"));
  assert(!s.includes("## How to engage"));
  // present sections still render
  assert(s.includes("## About this store"));
});

Deno.test("CACHEABILITY: system instruction does not depend on the message/history", () => {
  // Same store config -> byte-identical prefix regardless of the live turn.
  const a = buildSystemInstruction(cfg());
  const b = buildSystemInstruction(cfg());
  assertEquals(a, b);
  // It is a function of config only — no message is ever passed in — so it
  // cannot vary turn-to-turn. (Compile-time guarantee, asserted here for intent.)
  assert(!a.includes("where is my order"));
});

Deno.test("CACHEABILITY: new message is appended strictly last; history is an untouched prefix", () => {
  const history: Content[] = [
    { role: "user", parts: [{ text: "hi" }] },
    { role: "model", parts: [{ text: "hello!" }] },
  ];
  const contents = buildContents(history, "do you have atta?");
  // history is preserved verbatim as the leading prefix
  assertEquals(contents.slice(0, history.length), history);
  // the new message is the final entry, role user
  const last = contents[contents.length - 1];
  assertEquals(last.role, "user");
  assertEquals(last.parts[0].text, "do you have atta?");
  assertEquals(contents.length, history.length + 1);
});

Deno.test("shapeHistory: rows -> alternating user/model, oldest-first, skips empties", () => {
  const out = shapeHistory([
    { user_message: "hi", assistant_response: "hello" },
    { user_message: "atta?", assistant_response: null }, // half-turn: model skipped
    { user_message: null, assistant_response: "back in stock" }, // user skipped
  ]);
  assertEquals(out.map((c) => c.role), ["user", "model", "user", "model"]);
  assertEquals(out[0].parts[0].text, "hi");
  assertEquals(out[3].parts[0].text, "back in stock");
});

Deno.test("routing gate: owner-handled silences the bot; idle/null does not", () => {
  assertEquals(shouldBotRespond("active_owner_handling"), false);
  assertEquals(shouldBotRespond("idle"), true);
  assertEquals(shouldBotRespond(null), true);
  assertEquals(shouldBotRespond(undefined), true);
});

Deno.test("detectLanguage: script heuristic with English default", () => {
  assertEquals(detectLanguage("नमस्ते, आटा है?"), "hi");
  assertEquals(detectLanguage("మీరు డెలివరీ చేస్తారా?"), "te");
  assertEquals(detectLanguage("Do you have atta?"), "en");
  assertEquals(detectLanguage("namaste bhaiya"), "en"); // romanized -> not detected
});
