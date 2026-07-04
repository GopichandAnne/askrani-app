// Conversation prompt assembly — Bot Phase 2 (pure, no I/O).
//
// These functions are deterministic and side-effect-free so they can be
// unit-tested without the Gemini key or a database. The whole design goal is
// CACHEABILITY: Gemini's implicit caching keys on the longest common PREFIX of
// consecutive requests, so the *stable* content (store config + KB) must sit at
// the very front and never vary turn-to-turn, while the *volatile* content
// (history + the new message) is appended at the end.
//
//   request = systemInstruction (STABLE prefix)  +  contents (history … new msg)
//
// buildSystemInstruction() depends ONLY on store config — never on the current
// message or history — so it is byte-identical for every turn in a store and
// caches cleanly. buildContents() appends the new message strictly last, so each
// turn's contents is a prefix of the next turn's (after the prior turn folds
// into history), preserving the cache prefix as the conversation grows.
//
// Knowledge (products, saved_qa, documents) is deliberately NOT in the prefix —
// it's fetched on demand via tools (search_products, and search_knowledge in
// Phase 3b), keeping the cached prefix lean and stable.

/** A Gemini content part. */
export interface Part {
  text: string;
}

/** A Gemini content turn. role "user" = customer, "model" = the bot. */
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

/** Store-level conversation config assembled from agent_config + the store row. */
export interface AgentConfig {
  storeName: string;
  businessType: string | null;
  personality: string | null;
  offTopicHandling: string | null;
  languageHandling: string | null;
  engageInfo: string | null;
  storePrompt: string | null;
  /** How many prior turns to load into context (agent_config history_turns). */
  historyTurns: number;
}

// Baked-in operating rules — part of the stable prefix, identical across stores.
const BASE_RULES = [
  "You are replying inside WhatsApp. Keep replies short and warm.",
  "Reply in the SAME language and script the customer used in their LATEST",
  "message — romanized Hindi/Telugu/etc. → reply in that same romanized",
  "language; Devanagari → Devanagari; English → English — even if earlier",
  "messages in this chat were in a different language.",
  "Do NOT use markdown: no #, no * or ** emphasis, no bullet characters or",
  "tables. Write plain sentences; to list items, put each on its own line like",
  "'Name — $price'.",
  "You MUST call search_products BEFORE stating whether the store has an item,",
  "or giving any price or in-stock status — never answer that from memory or",
  "assumption, even for common items you think you know. Trust ONLY the tool",
  "result: if it shows an item out of stock, say it's currently out; if the",
  "search returns nothing, say you'll check with the store — never claim",
  "availability you haven't verified with a search.",
  "When a customer asks what to buy or what you'd recommend — including for",
  "comfort needs like a cold or a party — search the catalog and suggest",
  "relevant products the store actually sells. You may suggest groceries",
  "(teas, honey, ginger, etc.), but do not give medical or professional advice.",
  "When a policy has a limit or condition — a delivery radius, a free-delivery",
  "threshold, a same-day cutoff time, a return window — APPLY it to the",
  "customer's specific situation and give them the answer; don't just recite the",
  "rule and leave them to work it out. If their case falls outside a limit, say",
  "so plainly and offer the best alternative (for example, pickup). If you're",
  "missing a detail needed to decide — their distance or address, order total,",
  "or the time — ask for it.",
  "To help a customer buy, build a cart: use search_products to find each item,",
  "then add_to_cart with its exact sku (the cart holds real catalog prices). Use",
  "view_cart to show the cart and running subtotal, and remove_from_cart or",
  "clear_cart to edit. Always confirm what you added and read the subtotal from",
  "the tool result — never invent a price or total.",
  "You CANNOT place, confirm, or finalize an order yet. When a customer is ready",
  "to order, read back their cart and subtotal and tell them a store team member",
  "will confirm the order and total with them shortly. NEVER say an order has",
  "been placed, noted, confirmed, or is being prepared — you have no way to place",
  "one, so claiming otherwise would be false.",
].join(" ");

/**
 * Assemble the STABLE system instruction for a store. Depends only on `c` —
 * NOT on the current message or history — so it is identical every turn and
 * forms the cacheable prefix. Sections are omitted when empty so the string
 * stays stable (an unset field doesn't inject a blank header).
 */
export function buildSystemInstruction(c: AgentConfig): string {
  const out: string[] = [];
  const who = c.businessType
    ? `${c.storeName} (a ${c.businessType})`
    : c.storeName;
  out.push(`You are Rani, the AI shopping assistant for ${who}.`);
  out.push(BASE_RULES);

  if (c.personality) out.push(`\n## Personality\n${c.personality}`);
  if (c.storePrompt) out.push(`\n## About this store\n${c.storePrompt}`);
  if (c.engageInfo) out.push(`\n## How to engage\n${c.engageInfo}`);
  if (c.languageHandling) out.push(`\n## Language\n${c.languageHandling}`);
  if (c.offTopicHandling) out.push(`\n## Off-topic requests\n${c.offTopicHandling}`);

  return out.join("\n");
}

/**
 * Map prior conversation rows (oldest-first) into alternating user/model
 * contents. Empty sides are skipped so a half-logged turn can't desync roles.
 */
export function shapeHistory(
  rows: { user_message: string | null; assistant_response: string | null }[],
): Content[] {
  const out: Content[] = [];
  for (const r of rows) {
    if (r.user_message) out.push({ role: "user", parts: [{ text: r.user_message }] });
    if (r.assistant_response) {
      out.push({ role: "model", parts: [{ text: r.assistant_response }] });
    }
  }
  return out;
}

/**
 * Build the `contents` array: history first (untouched), the new customer
 * message appended strictly LAST. This ordering is what keeps the cache prefix
 * intact across turns.
 */
export function buildContents(history: Content[], currentText: string): Content[] {
  return [...history, { role: "user", parts: [{ text: currentText }] }];
}

/**
 * Routing gate: when an owner has taken over a thread, the bot stays silent.
 * Anything other than active_owner_handling (idle, null) -> bot may respond.
 */
export function shouldBotRespond(routingState: string | null | undefined): boolean {
  return routingState !== "active_owner_handling";
}

/**
 * Lightweight language tag for analytics (dashboard reads analytics_json.language).
 * Script-based heuristic only — detects South Asian scripts, defaults to "en".
 * Does NOT catch romanized text (e.g. "namaste" in Latin) — good enough for a
 * v1 signal; can be upgraded to an LLM-returned tag later.
 */
export function detectLanguage(text: string): string {
  if (/[ऀ-ॿ]/.test(text)) return "hi"; // Devanagari (Hindi/Marathi)
  if (/[ఀ-౿]/.test(text)) return "te"; // Telugu
  if (/[஀-௿]/.test(text)) return "ta"; // Tamil
  if (/[઀-૿]/.test(text)) return "gu"; // Gujarati
  if (/[਀-੿]/.test(text)) return "pa"; // Gurmukhi (Punjabi)
  if (/[ঀ-৿]/.test(text)) return "bn"; // Bengali
  if (/[ഀ-ൿ]/.test(text)) return "ml"; // Malayalam
  if (/[ಀ-೿]/.test(text)) return "kn"; // Kannada
  return "en";
}
