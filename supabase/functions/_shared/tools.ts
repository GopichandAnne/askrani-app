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
  addToCart,
  type CartLine,
  cartSubtotal,
  clearCart,
  removeFromCart,
  viewCart,
} from "./cart.ts";
import { placeOrder } from "./order.ts";

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
    "call again with the new total; quantity 0 removes it. Refuses items that " +
    "are out of stock or not found. Prices are taken from the live catalog, not " +
    "from you.",
  parameters: {
    type: "object",
    properties: {
      sku: { type: "string", description: "Exact product sku from search_products." },
      quantity: { type: "number", description: "Desired quantity (0 removes the item)." },
    },
    required: ["sku", "quantity"],
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

/** Cart shape returned to the model (subtotal is code-computed, not model math). */
function formatCart(lines: CartLine[]): Record<string, unknown> {
  return {
    items: lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price,
      line_total: l.line_total,
    })),
    subtotal: cartSubtotal(lines),
    currency: "USD",
    count: lines.length,
  };
}

/** Build the toolset bound to a store + session context. */
export function buildToolset(db: SupabaseClient, store: Store, sessionId: string): Toolset {
  const executors: Record<string, ToolExecutor> = {
    search_products: (args) => executeSearchProducts(db, store, args),
    search_knowledge: (args) => executeSearchKnowledge(db, store, args),
    add_to_cart: async (args) => {
      const res = await addToCart(db, store, sessionId, String(args.sku ?? ""), Number(args.quantity ?? 1));
      const cart = formatCart(res.lines);
      switch (res.status) {
        case "added": return { added: true, item: res.name, cart };
        case "removed": return { removed: true, cart };
        case "out_of_stock": return { added: false, reason: "out of stock", item: res.name, cart };
        case "no_price": return { added: false, reason: "no price on file", item: res.name, cart };
        default: return { added: false, reason: "not found — search_products first", cart };
      }
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
  };
  return {
    declarations: [
      SEARCH_PRODUCTS_DECL,
      SEARCH_KNOWLEDGE_DECL,
      ADD_TO_CART_DECL,
      VIEW_CART_DECL,
      REMOVE_FROM_CART_DECL,
      CLEAR_CART_DECL,
      PLACE_ORDER_DECL,
    ],
    execute: async (name, args) => {
      const fn = executors[name];
      if (!fn) return { error: `unknown tool: ${name}` };
      return await fn(args);
    },
  };
}
