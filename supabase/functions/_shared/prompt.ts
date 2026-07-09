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
  text?: string;
  inlineData?: { mimeType: string; data: string }; // base64 media on the current turn
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
  /** Owner's ordering/checkout instructions (only used when ordersEnabled). */
  orderPrompt: string | null;
  /** Owner's promotion instructions — what to promote and when; woven in
   *  naturally and sparingly. Null/empty = no store-specific promotions. */
  promotions: string | null;
  /** When false the bot is info/nav/Q&A only — no cart/order tools or rules. */
  ordersEnabled: boolean;
  /** IANA timezone for the store's local clock (defaults applied in loader). */
  timezone: string;
  /** store_hours JSON (day index -> [open, close]) or null. */
  storeHours: string | null;
  /** true = structured catalogue set (bot may look up + show prices); false =
   *  request mode (KB-only; bot NEVER quotes a price; all orders are requests). */
  catalogEnabled: boolean;
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
  "Never claim an item is available or unavailable unless you actually verified",
  "it (a product or knowledge search) — otherwise say you'll check with the",
  "store. When a customer asks what to buy or what you'd recommend (including for",
  "comfort needs like a cold, or a party), look up and suggest relevant items the",
  "store actually sells; you may suggest products but never give medical or",
  "professional advice.",
  "When a policy has a limit or condition — a delivery radius, a free-delivery",
  "threshold, a same-day cutoff time, a return window — APPLY it to the",
  "customer's specific situation and give them the answer; don't just recite the",
  "rule and leave them to work it out. If their case falls outside a limit, say",
  "so plainly and offer the best alternative (for example, pickup). If you're",
  "missing a detail needed to decide — their distance or address, order total,",
  "or the time — ask for it.",
  "Each customer message may begin with a context line like",
  "'[NOW: Saturday, July 4, 2026, 9:15 PM | STORE: OPEN (today 9:00 AM to 9:00",
  "PM)]'. This is for you only — NEVER repeat it back. Use it for today/tomorrow,",
  "pickup timing, and whether the store is open. The STORE flag is authoritative:",
  "do not contradict it or recompute open/closed from the time yourself. Do not",
  "volunteer closed-status unless the customer asks about hours, visiting, or",
  "pickup timing.",
  "When a customer asks something you cannot answer from this prompt, the",
  "catalog, or a knowledge search — a store policy, a promotion, holiday hours,",
  "whether an unusual or non-grocery item is carried — or asks you to check with",
  "the store or owner, or reports a real problem (wrong price, missing item,",
  "something broken): call escalate_to_owner with their question written in",
  "English, then tell them you will check with the store team and get back to",
  "them. First try a knowledge search for policy/FAQ questions; escalate only if",
  "it returns nothing useful. Do NOT escalate greetings, acknowledgments (ok,",
  "thanks), questions you can answer, or hostile/venting messages.",
  "The customer may send a PHOTO. Look at it and respond to what it actually",
  "shows — identify the item, read a label or handwritten list, answer their",
  "question about it — and search the catalog or knowledge base as needed. Never",
  "pretend to see a photo that wasn't sent.",
  "When the customer asks to SEE something the store may have a picture of — its",
  "menu, a flyer, a product photo — call send_image with a short query. You MAY",
  "also send a relevant picture on your own initiative when it genuinely helps —",
  "to show a product you're recommending, or a flyer for a promotion you're",
  "mentioning — but do this occasionally and only when it adds value: at most one",
  "image per reply, never as spam. If send_image returns sent:false, don't mention",
  "a picture; never claim you sent an image when you did not.",
  // Conversational flow: talk like a person, not a FAQ endpoint.
  "Talk like a helpful person, not a form. Vary your wording and don't dead-end:",
  "after answering, when it feels natural, add ONE short, relevant follow-up that",
  "moves things forward — a clarifying question, a suggestion, or an offer to help",
  "with the next step. But don't tack a question onto every message and never",
  "badger. If the request is ambiguous or the customer seems mid-decision, ask a",
  "brief clarifying question instead of guessing. If something earlier was left",
  "unfinished — an order half-built, a question half-answered — and they drift,",
  "gently offer once to pick it back up; if they're not interested, let it go. A",
  "quick thanks or goodbye just needs a warm, brief close — no upsell, no question.",
].join(" ");

// CATALOGUE mode only: the store has a live priced product catalogue.
const CATALOG_RULES = [
  "You have a live product catalogue. You MUST call search_products BEFORE stating",
  "whether the store has an item, its price, or its stock — never from memory.",
  "Trust only the tool result: if it shows out of stock, say it's currently out;",
  "if the search returns nothing, say you'll check with the store.",
].join(" ");

// REQUEST mode only: no priced catalogue — the bot must never surface a price.
const REQUEST_PRICING_RULE = [
  "IMPORTANT: this store has no price list available to you. NEVER state,",
  "estimate, or read out a price or a total — not from your knowledge, not from",
  "any document, menu, or image, not from memory — even if the customer insists.",
  "If asked a price or total, say the store team confirms pricing when the order",
  "is placed. You may tell them what the store carries, but always without prices.",
].join(" ");

// Locked ordering/money-safety rules — appended ONLY when ordering is enabled,
// always on top of the owner's order_prompt. Owners can't edit these away.
// CATALOGUE-mode ordering (priced cart).
const CATALOG_ORDERING_RULES = [
  "To help a customer buy, build a cart: use search_products to find each item,",
  "then add_to_cart with its exact sku. view_cart shows the cart and running",
  "subtotal; remove_from_cart / clear_cart edit it. Some items may have no price",
  "set — that's fine, add them anyway and say the store team will confirm that",
  "price. Read prices and the subtotal from the tool result — NEVER invent a",
  "price or total for any item.",
  "For an item not cleanly in the catalog — fresh produce with no match, an",
  "unusual item, or a weight/volume request — use add_request_item; never refuse",
  "a fresh-produce request. A number with a weight or volume unit is a TOTAL, not",
  "a count: '5 kg of jamun' is quantity 1 with '5 kg' in the description, not",
  "quantity 5. Capture a stated preference (ripe ones, small pack) as notes.",
  "To take an order: when done, call view_cart and show the itemized cart — show",
  "each priced item's price and the subtotal, and for any item with no price say",
  "its price will be confirmed by the store team (never quote a number you didn't",
  "get from a cart tool). Ask pickup or delivery, then ask ONE explicit question:",
  "if every item is priced — 'Shall I place this order for $TOTAL for [pickup/",
  "delivery]? (yes/no)'; if any item is unpriced — 'Shall I place this order for",
  "[pickup/delivery]? Our team will confirm the price and your total. (yes/no)'.",
  "Call place_order ONLY on a clear, standalone yes to THAT question (yes / place",
  "it / haan kar do / avunu) — not on a vague ok or emoji (re-ask), not on a yes",
  "bundled with a change (make it, re-quote, ask again), not on a yes to another",
  "question. Pass the exact words as confirmation_text. If place_order reports",
  "out_of_stock or price_changed, nothing was placed — tell the customer, adjust,",
  "re-confirm. On success, give the order number; if the order has unpriced items",
  "or is delivery, say the store team will confirm the final total (with any",
  "pricing, delivery, or other charges) shortly.",
].join(" ");

// REQUEST-mode ordering (no prices — every line is a request the store prices).
const REQUEST_ORDERING_RULES = [
  "To take an order here, capture every item the customer wants with",
  "add_request_item (description + quantity, plus any preference as notes) — you",
  "have no product catalogue or prices in this mode. A number with a weight or",
  "volume unit is a TOTAL, not a count: '5 kg jamun' is quantity 1 with '5 kg' in",
  "the description. Never refuse an item; the store sources and prices everything.",
  "view_cart shows the list; remove_from_cart / clear_cart edit it. When the",
  "customer is done, show the itemized list WITHOUT any prices and ask ONE explicit",
  "question: 'Shall I place this order for [pickup/delivery]? The store team will",
  "confirm the items, prices, and your total. (yes/no)'. Call place_order ONLY on",
  "a clear standalone yes to THAT question — not a vague ok or emoji (re-ask), not",
  "a yes with a change (make it, re-ask), not a yes to another question. Pass the",
  "exact words as confirmation_text. On success, give the order number and say the",
  "store team will confirm the items and total shortly.",
].join(" ");

// Shared across modes: handling the customer's reply to a priced proposal.
const PROPOSAL_RULES = [
  "If a message begins with [PENDING PROPOSAL: order X, total $Y ...], the store",
  "has priced an order and is awaiting the customer's decision. If their reply is",
  "a short clear yes with no new request (yes, confirm, ok, sure, go ahead, looks",
  "good, thanks, a thumbs-up), call confirm_proposed_order(X) and reply briefly",
  "and warmly (order confirmed, see you for pickup). If they clearly want it gone",
  "(cancel, never mind, forget it, I changed my mind), call",
  "cancel_proposed_order(X). If they want to negotiate — too expensive, a",
  "different size or brand — but still want it, call escalate_to_owner with their",
  "concern; do NOT negotiate prices yourself. If their reply mixes a yes with a",
  "change or a question, or is a bare 'no', ask them to clarify before calling any",
  "tool. If they change the subject, answer normally and leave the proposal",
  "pending.",
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
  // Catalogue mode -> priced product tools + rules. Request mode -> never quote
  // a price (the price-returning tools aren't attached either; see buildToolset).
  out.push(c.catalogEnabled ? CATALOG_RULES : REQUEST_PRICING_RULE);

  if (c.personality) out.push(`\n## Personality\n${c.personality}`);
  if (c.storePrompt) out.push(`\n## About this store\n${c.storePrompt}`);
  if (c.engageInfo) out.push(`\n## How to engage\n${c.engageInfo}`);
  if (c.languageHandling) out.push(`\n## Language\n${c.languageHandling}`);
  if (c.offTopicHandling) out.push(`\n## Off-topic requests\n${c.offTopicHandling}`);

  // Promotions: owner-authored, woven in naturally. Guardrails travel WITH the
  // section so an owner can't accidentally turn Rani into a billboard, and so
  // request-mode price safety still holds.
  if (c.promotions && c.promotions.trim()) {
    out.push(
      `\n## Promotions\n${c.promotions.trim()}\n\n` +
        "Weave these in naturally and sparingly — only when they genuinely fit " +
        "what the customer is asking about or buying, and at most once in a " +
        "conversation unless they ask. Never let a promotion delay or replace " +
        "answering their actual question, and never be pushy. Follow the store's " +
        "pricing rules: if you can't quote prices, describe the offer without exact " +
        "totals and let the team confirm. If a promotion has a matching picture on " +
        "file, you may show it with send_image.",
    );
  }

  // Ordering is optional per store; when on, the mode picks the checkout rules,
  // the shared proposal rules apply, and the owner's order_prompt sits on top.
  if (c.ordersEnabled) {
    out.push(`\n${c.catalogEnabled ? CATALOG_ORDERING_RULES : REQUEST_ORDERING_RULES}`);
    out.push(`\n${PROPOSAL_RULES}`);
    if (c.orderPrompt) out.push(`\n## Ordering\n${c.orderPrompt}`);
  }

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
