// Tool declarations + executors for the Gemini function-calling loop — Phase 3a.
//
// Retrieval-on-demand: the model calls these tools; results come back as
// functionResponse parts in the VOLATILE contents, never the cached prefix.
// Language intelligence lives in the model — it normalizes the customer's
// (possibly romanized/multilingual) message into a clean `query` before calling.
// search_knowledge (RAG) joins this same toolset in Phase 3b.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { embedQuery, toVectorLiteral } from "./embeddings.ts";
import {
  addRequestItem,
  addToCart,
  type CartLine,
  cartSubtotal,
  clearCart,
  removeFromCart,
  viewCart,
} from "./cart.ts";
import {
  cancelProposedOrder,
  confirmProposedOrder,
  deriveOrderPrefix,
  placeOrder,
} from "./order.ts";
import { notifyResponders } from "./responders.ts";

// ── Gemini functionDeclaration shapes ───────────────────────────────────────
export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/** name -> executor. Returns a JSON-serializable result for the model. */
export type ToolExecutor = (
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface Toolset {
  declarations: FunctionDeclaration[];
  execute: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

// ── product <-> text (index-time embedding input; keep stable & descriptive) ─
/** The text embedded for a product. Name + brand + category — NOT price/stock
 *  (those change and would needlessly re-stale the embedding). Must stay in sync
 *  with the reindex path (same fields feed embedding_stale in migration 0013). */
export function productEmbedText(p: {
  name: string;
  brand?: string | null;
  category?: string | null;
  size?: string | null;
  unit?: string | null;
}): string {
  return [p.name, p.brand, p.category, [p.size, p.unit].filter(Boolean).join(" ")]
    .filter((s) => s && String(s).trim())
    .join(" · ");
}

const SEARCH_PRODUCTS_DECL: FunctionDeclaration = {
  name: "search_products",
  description:
    "Search this store's product catalog by meaning AND keyword (hybrid). Use it " +
    "whenever the customer asks about a product, price, or availability. Pass a " +
    "clear English query normalized from the customer's message (translate " +
    "romanized/other-language terms, e.g. 'methi'->'fenugreek leaves (methi)', " +
    "'atta'->'wheat flour (atta)'). You may describe by need ('medicine for a " +
    "cold') — semantic search will match. Returns top matches with price and " +
    "stock; an item may be returned but out of stock.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Normalized English description of the desired product or need.",
      },
    },
    required: ["query"],
  },
};

const SEARCH_KNOWLEDGE_DECL: FunctionDeclaration = {
  name: "search_knowledge",
  description:
    "Search the store's knowledge base — policies, hours, delivery/return rules, " +
    "FAQs, and curated answers — for anything that is NOT a specific product " +
    "lookup. Use it for questions like 'do you deliver?', 'what are your hours?', " +
    "'what's your return policy?'. Pass a normalized English query. Returns the " +
    "most relevant snippets; if nothing relevant comes back, say you'll check " +
    "with the store rather than guessing.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Normalized English description of what the customer wants to know.",
      },
    },
    required: ["query"],
  },
};

const SEARCH_PRODUCTS_LIMIT = 5;
const SEARCH_KNOWLEDGE_LIMIT = 4;

async function executeSearchProducts(
  db: SupabaseClient,
  store: Store,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = String(args.query ?? "").trim();
  if (!query) return { products: [], note: "empty query" };

  let embedding: number[];
  try {
    embedding = await embedQuery(query);
  } catch (e) {
    console.error(`[tools] search_products embed failed: ${e instanceof Error ? e.message : e}`);
    return { products: [], note: "search temporarily unavailable — offer to check with the store" };
  }
  const { data, error } = await db.rpc("search_products", {
    p_store_id: store.id,
    p_query: query,
    p_query_embedding: toVectorLiteral(embedding),
    p_limit: SEARCH_PRODUCTS_LIMIT,
  });
  if (error) {
    console.error(`[tools] search_products: ${error.message}`);
    return { products: [], note: "search failed" };
  }
  // Compact rows for the model. sku is included so it can add_to_cart exactly.
  const products = (data ?? []).map(
    (r: {
      sku: string | null; name: string; brand: string | null; size: string | null;
      unit: string | null; price: number | null; currency: string | null;
      in_stock: boolean; category: string | null;
    }) => ({
      sku: r.sku,
      name: r.name,
      brand: r.brand,
      size: r.size,
      unit: r.unit,
      price: r.price,
      currency: r.currency,
      in_stock: r.in_stock,
      category: r.category,
    }),
  );
  return { products, count: products.length };
}

async function executeSearchKnowledge(
  db: SupabaseClient,
  store: Store,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = String(args.query ?? "").trim();
  if (!query) return { snippets: [], note: "empty query" };

  let embedding: number[];
  try {
    embedding = await embedQuery(query);
  } catch (e) {
    console.error(`[tools] search_knowledge embed failed: ${e instanceof Error ? e.message : e}`);
    return { snippets: [], note: "search temporarily unavailable — offer to check with the store" };
  }
  const { data, error } = await db.rpc("search_knowledge", {
    p_store_id: store.id,
    p_query_embedding: toVectorLiteral(embedding),
    p_limit: SEARCH_KNOWLEDGE_LIMIT,
  });
  if (error) {
    console.error(`[tools] search_knowledge: ${error.message}`);
    return { snippets: [], note: "search failed" };
  }
  const snippets = (data ?? []).map(
    (r: { kind: string; source_ref: string | null; chunk_text: string }) => ({
      source: r.source_ref,
      kind: r.kind,
      text: r.chunk_text,
    }),
  );
  return { snippets, count: snippets.length };
}

// ── cart tools ───────────────────────────────────────────────────────────────
const ADD_TO_CART_DECL: FunctionDeclaration = {
  name: "add_to_cart",
  description:
    "Add a catalog item to the cart, or set its quantity. FIRST call " +
    "search_products to find the item and its exact `sku`, then call this with " +
    "that sku. This SETS the quantity (not increments) — to change a quantity, " +
    "call again with the new total; quantity 0 removes it. Optionally pass a " +
    "`notes` preference the customer stated (e.g. 'small pack', 'ripe ones'). " +
    "Refuses items out of stock or not found. Prices come from the live catalog.",
  parameters: {
    type: "object",
    properties: {
      sku: { type: "string", description: "Exact product sku from search_products." },
      quantity: { type: "number", description: "Desired quantity (0 removes the item)." },
      notes: { type: "string", description: "Optional customer preference for this item." },
    },
    required: ["sku", "quantity"],
  },
};
const ADD_REQUEST_ITEM_DECL: FunctionDeclaration = {
  name: "add_request_item",
  description:
    "Add an item that is NOT cleanly in the catalog — fresh produce with no " +
    "clean match, an unusual item, or a WEIGHT/VOLUME request (e.g. '5 kg of " +
    "jamun'). The store team sources and prices it. A number with a weight or " +
    "volume unit is a TOTAL amount, not a count: use quantity 1 and put the " +
    "weight in the description ('5 kg fresh jamun'), NOT quantity 5. Never refuse " +
    "a fresh-produce request — capture it here.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "The item as the customer described it, including any weight/volume." },
      quantity: { type: "number", description: "Count of units (default 1). For a weight request, keep this 1." },
      notes: { type: "string", description: "Optional customer preference." },
    },
    required: ["description"],
  },
};
const VIEW_CART_DECL: FunctionDeclaration = {
  name: "view_cart",
  description: "Show the customer's current cart with line totals and subtotal.",
  parameters: { type: "object", properties: {}, required: [] },
};
const REMOVE_FROM_CART_DECL: FunctionDeclaration = {
  name: "remove_from_cart",
  description: "Remove an item from the cart by its sku.",
  parameters: {
    type: "object",
    properties: { sku: { type: "string", description: "Exact product sku to remove." } },
    required: ["sku"],
  },
};
const CLEAR_CART_DECL: FunctionDeclaration = {
  name: "clear_cart",
  description: "Empty the cart entirely.",
  parameters: { type: "object", properties: {}, required: [] },
};
const PLACE_ORDER_DECL: FunctionDeclaration = {
  name: "place_order",
  description:
    "Finalize the cart into an order request for the store team to confirm. ONLY " +
    "call this after the customer gave a clear, explicit YES to the specific " +
    "question 'shall I place this order for $TOTAL?'. NEVER for a vague ok, an " +
    "emoji, a yes bundled with a change, or a yes to a different question. The " +
    "server re-checks stock and price at this moment — if it reports out_of_stock " +
    "or price_changed, nothing was placed: tell the customer, adjust, re-confirm.",
  parameters: {
    type: "object",
    properties: {
      fulfillment: { type: "string", description: "'pickup' or 'delivery'." },
      confirmation_text: {
        type: "string",
        description: "The customer's exact affirmative words that confirmed placement.",
      },
    },
    required: ["fulfillment", "confirmation_text"],
  },
};

/** Cart shape returned to the model (subtotal is code-computed, not model math).
 *  unit_price/line_total are null for unpriced items — the model must say the
 *  store team will confirm that price, never guess it. */
function formatCart(lines: CartLine[]): Record<string, unknown> {
  return {
    items: lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price, // null = unpriced
      line_total: l.line_total,
      request: l.request || undefined,
      notes: l.notes || undefined,
    })),
    subtotal: cartSubtotal(lines), // priced items only
    currency: "USD",
    count: lines.length,
    has_unpriced: lines.some((l) => l.unit_price == null),
  };
}

const CONFIRM_PROPOSAL_DECL: FunctionDeclaration = {
  name: "confirm_proposed_order",
  description:
    "Confirm a proposed order the store priced and sent to the customer. Call " +
    "ONLY when the customer gives a short clear yes to it (yes, confirm, ok, " +
    "sure, go ahead, looks good, a thumbs-up) with no new request or change.",
  parameters: {
    type: "object",
    properties: { order_id: { type: "string", description: "The proposed order id, e.g. MPL-2026-0007." } },
    required: ["order_id"],
  },
};
const CANCEL_PROPOSAL_DECL: FunctionDeclaration = {
  name: "cancel_proposed_order",
  description:
    "Cancel a proposed order when the customer clearly wants it gone (cancel, " +
    "never mind, forget it, I changed my mind). For price/size negotiation (they " +
    "still want it), use escalate_to_owner instead. For a bare 'no', ask first.",
  parameters: {
    type: "object",
    properties: {
      order_id: { type: "string", description: "The proposed order id." },
      reason: { type: "string", description: "The customer's reason, in their words." },
    },
    required: ["order_id"],
  },
};

const ESCALATE_DECL: FunctionDeclaration = {
  name: "escalate_to_owner",
  description:
    "Route a question or problem to the store team when you genuinely cannot " +
    "answer it — a store policy/promotion not in the knowledge base, an unusual " +
    "or non-grocery item, a customer asking you to check with the store/owner, " +
    "or a reported problem (wrong price, missing item). Try a knowledge search " +
    "first. After calling this, tell the customer you'll check and get back to " +
    "them. Do NOT use it for greetings, acknowledgments, or hostile messages.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The customer's question or problem, written in English for the owner.",
      },
    },
    required: ["question"],
  },
};

async function executeEscalate(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const question = String(args.question ?? "").trim();
  if (!question) return { escalated: false, reason: "no question" };

  const customerPhone = sessionId.startsWith("wa_") ? sessionId.slice(3) : sessionId;
  const threadId = `thr_${customerPhone}_${store.slug}`;
  const ticketId = `${deriveOrderPrefix(store.slug)}-Q-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  const { data: thread } = await db
    .from("threads")
    .select("customer_name")
    .eq("thread_id", threadId)
    .maybeSingle();

  const { error } = await db.from("tickets").insert({
    ticket_id: ticketId,
    store_slug: store.slug,
    session_id: sessionId,
    customer_phone: customerPhone,
    customer_name: thread?.customer_name ?? null,
    question,
    status: "sent_to_owner",
  });
  if (error) {
    console.error(`[tools] escalate: ${error.message}`);
    return { escalated: false, reason: "could not create ticket" };
  }

  // Timeline event so it shows in Conversations + Tickets.
  await db.from("threads").upsert(
    { thread_id: threadId, store_slug: store.slug, customer_phone: customerPhone },
    { onConflict: "thread_id", ignoreDuplicates: true },
  );
  await db.from("thread_messages").insert({
    message_id: `evt_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: customerPhone,
    direction: "system",
    sender: "bot",
    kind: "event",
    event_type: "ticket_opened",
    text: `Escalated to store: ${question}`,
    event_payload_json: { ticket_id: ticketId, question },
  });

  // DM the store's responders so they can answer from their own WhatsApp.
  await notifyResponders(
    db, store, "escalation",
    `A customer asked: ${question}\n\nReply to this message to answer them (Rani will pass it along).`,
  );

  return { escalated: true, ticket_id: ticketId };
}

/** Build the toolset bound to a store + session context. Cart/order tools are
 *  attached only when ordering is enabled for the store (Agent Setup). */
export function buildToolset(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  ordersEnabled: boolean,
  hasProposal = false,
): Toolset {
  const executors: Record<string, ToolExecutor> = {
    search_products: (args) => executeSearchProducts(db, store, args),
    search_knowledge: (args) => executeSearchKnowledge(db, store, args),
    escalate_to_owner: (args) => executeEscalate(db, store, sessionId, args),
    add_to_cart: async (args) => {
      const res = await addToCart(
        db, store, sessionId, String(args.sku ?? ""), Number(args.quantity ?? 1),
        args.notes ? String(args.notes) : null,
      );
      const cart = formatCart(res.lines);
      switch (res.status) {
        case "added": return { added: true, item: res.name, cart };
        case "removed": return { removed: true, cart };
        case "out_of_stock": return { added: false, reason: "out of stock", item: res.name, cart };
        default: return { added: false, reason: "not found — search_products first", cart };
      }
    },
    add_request_item: async (args) => {
      const res = await addRequestItem(
        db, store, sessionId, String(args.description ?? ""), Number(args.quantity ?? 1),
        args.notes ? String(args.notes) : null,
      );
      return { added: true, item: res.name, request: true, cart: formatCart(res.lines) };
    },
    view_cart: async () => formatCart(await viewCart(db, sessionId)),
    remove_from_cart: async (args) => {
      const res = await removeFromCart(db, store, sessionId, String(args.sku ?? ""));
      return { removed: res.removed, cart: formatCart(res.lines) };
    },
    clear_cart: async () => {
      await clearCart(db, store, sessionId);
      return { cleared: true, cart: formatCart([]) };
    },
    place_order: (args) =>
      placeOrder(
        db,
        store,
        sessionId,
        args.fulfillment === "delivery" ? "delivery" : "pickup",
        String(args.confirmation_text ?? ""),
      ),
    confirm_proposed_order: (args) =>
      confirmProposedOrder(db, store, sessionId, String(args.order_id ?? "")),
    cancel_proposed_order: (args) =>
      cancelProposedOrder(db, store, sessionId, String(args.order_id ?? ""), String(args.reason ?? "customer request")),
  };
  const declarations: FunctionDeclaration[] = [SEARCH_PRODUCTS_DECL, SEARCH_KNOWLEDGE_DECL, ESCALATE_DECL];
  if (ordersEnabled) {
    declarations.push(
      ADD_TO_CART_DECL,
      ADD_REQUEST_ITEM_DECL,
      VIEW_CART_DECL,
      REMOVE_FROM_CART_DECL,
      CLEAR_CART_DECL,
      PLACE_ORDER_DECL,
    );
    if (hasProposal) declarations.push(CONFIRM_PROPOSAL_DECL, CANCEL_PROPOSAL_DECL);
  }
  return {
    declarations,
    execute: async (name, args) => {
      const fn = executors[name];
      if (!fn) return { error: `unknown tool: ${name}` };
      return await fn(args);
    },
  };
}
