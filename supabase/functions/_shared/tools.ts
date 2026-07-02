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

  const embedding = await embedQuery(query);
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
  // Compact rows for the model (drop ids/scores it doesn't need).
  const products = (data ?? []).map(
    (r: {
      name: string; brand: string | null; size: string | null;
      unit: string | null; price: number | null; currency: string | null;
      in_stock: boolean; category: string | null;
    }) => ({
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

  const embedding = await embedQuery(query);
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

/** Build the toolset bound to a store's DB context. */
export function buildToolset(db: SupabaseClient, store: Store): Toolset {
  const executors: Record<string, ToolExecutor> = {
    search_products: (args) => executeSearchProducts(db, store, args),
    search_knowledge: (args) => executeSearchKnowledge(db, store, args),
  };
  return {
    declarations: [SEARCH_PRODUCTS_DECL, SEARCH_KNOWLEDGE_DECL],
    execute: async (name, args) => {
      const fn = executors[name];
      if (!fn) return { error: `unknown tool: ${name}` };
      return await fn(args);
    },
  };
}
