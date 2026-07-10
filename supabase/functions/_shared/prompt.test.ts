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
  splitBubbles,
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
    orderItemDetails: null,
    promotions: null,
    ordersEnabled: false,
    timezone: "America/Chicago",
    storeHours: null,
    catalogEnabled: true,
    kbPricesOk: false,
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

Deno.test("connector price exception: request mode + a connector only", () => {
  const EX = "EXCEPTION for live tool prices";
  // Request mode, no connector -> strict no-price rule, NO exception.
  assert(!buildSystemInstruction(cfg({ catalogEnabled: false })).includes(EX));
  // Request mode + a connector -> exception is added.
  assert(buildSystemInstruction(cfg({ catalogEnabled: false }), { hasConnector: true }).includes(EX));
  // Catalogue mode already allows prices -> exception is request-mode only.
  assert(!buildSystemInstruction(cfg({ catalogEnabled: true }), { hasConnector: true }).includes(EX));
});

Deno.test("kb_prices_ok: published-price exception only in request mode + opt-in", () => {
  const EX = "EXCEPTION for published prices";
  assert(!buildSystemInstruction(cfg({ catalogEnabled: false, kbPricesOk: false })).includes(EX));
  assert(buildSystemInstruction(cfg({ catalogEnabled: false, kbPricesOk: true })).includes(EX));
  // Catalogue mode already allows prices -> not added there.
  assert(!buildSystemInstruction(cfg({ catalogEnabled: true, kbPricesOk: true })).includes(EX));
});

Deno.test("non-disruption: no connector => byte-identical to the old prompt", () => {
  // Default opts, {}, and {hasConnector:false} must all produce the same string,
  // so a store without integrations is unaffected by the feature.
  const a = buildSystemInstruction(cfg());
  assertEquals(buildSystemInstruction(cfg(), {}), a);
  assertEquals(buildSystemInstruction(cfg(), { hasConnector: false }), a);
});

Deno.test("external action + payment guardrails are always present", () => {
  const s = buildSystemInstruction(cfg());
  assert(s.includes("ONLY AFTER"));
  assert(s.includes("NEVER ask for or accept card numbers"));
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
  assert(on.includes("at most once"));
  assert(on.includes("never be pushy"));
});

Deno.test("conversational-flow + proactive-image rules are always present", () => {
  const s = buildSystemInstruction(cfg());
  assert(s.includes("Talk like a helpful person, not a form"));
  assert(s.includes("on your own initiative")); // proactive send_image
  assert(s.includes("BLANK LINE")); // multi-bubble
});

Deno.test("splitBubbles: blank line / --- splits; lists & plain text stay one", () => {
  // Blank line = the natural bubble break the model produces.
  assertEquals(splitBubbles("Yes we do! 😊\n\nIt's in Aisle 5.\n\nWant me to add it?"), [
    "Yes we do! 😊",
    "It's in Aisle 5.",
    "Want me to add it?",
  ]);
  // Explicit --- marker also splits.
  assertEquals(splitBubbles("Hi there!\n---\nWe close at 9 PM."), ["Hi there!", "We close at 9 PM."]);
  // No blank line -> single bubble, untouched.
  assertEquals(splitBubbles("Rice is in Aisle 2. Any specific type?"), [
    "Rice is in Aisle 2. Any specific type?",
  ]);
  // Caps at 3 bubbles.
  assertEquals(splitBubbles("a\n\nb\n\nc\n\nd").length, 3);
  // A price list on single-newline lines is NOT split.
  assertEquals(splitBubbles("Basmati — $5\nSona — $4"), ["Basmati — $5\nSona — $4"]);
});

Deno.test("order detail rule appears only with ordering; store-specifics only when set", () => {
  // Universal rule is present when ordering is on, absent when off.
  assert(!buildSystemInstruction(cfg({ ordersEnabled: false })).includes("More detail is a bonus"));
  const on = buildSystemInstruction(cfg({ ordersEnabled: true }));
  assert(on.includes("More detail is a bonus"));
  assert(!on.includes("## Order details to collect")); // no store-specifics set

  // Store-specific list injects its own section (only when ordering is on).
  const withDetails = buildSystemInstruction(
    cfg({ ordersEnabled: true, orderItemDetails: "brand, size or pack, weight or count" }),
  );
  assert(withDetails.includes("## Order details to collect"));
  assert(withDetails.includes("brand, size or pack, weight or count"));
  // Ignored when ordering is off.
  assert(
    !buildSystemInstruction(cfg({ ordersEnabled: false, orderItemDetails: "brand" }))
      .includes("## Order details to collect"),
  );
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
