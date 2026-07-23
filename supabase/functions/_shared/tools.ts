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
import { resolveMember } from "./members.ts";
import { getOrCreateReferralLink, trackedUrl } from "./referral.ts";
import { composeAndStoreCard } from "./card.ts";
import { issueRedemptionPass, rewardBalanceCents } from "./rewards.ts";
import { activePostCampaign, createPostSubmission, describeRuleOffer, pickRuleForPlatform, platformFromUrl } from "./social.ts";
import {
  browseProducts,
  type CatalogFilter,
  coerceFilter,
  describeFilter,
  maySeePrices,
} from "./catalog.ts";
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
import { getStoreAccessToken } from "./config.ts";
import { sendImage } from "./wa.ts";
import {
  executeIntegration,
  integrationDeclaration,
  type StoreIntegration,
} from "./integrations.ts";
import {
  executeFileRequest,
  fileRequestDeclaration,
  type RequestType,
} from "./requests.ts";

// ── Gemini functionDeclaration shapes ───────────────────────────────────────
export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      { type: string; description?: string; items?: { type: string }; enum?: string[] }
    >;
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

/** Side channel from a tool to the CLIENT (not to the model). show_products
 *  fills this in; the web chat turns it into a filtered grid, WhatsApp turns it
 *  into a browse link. */
export type UiDirectives = {
  catalog_view?: {
    filter: CatalogFilter;
    total: number;
    note?: string;
    prices_hidden: boolean;
  };
};

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
    "with the store rather than guessing. A snippet with a `valid_until` date is a " +
    "time-limited offer/notice — you may mention the deadline (e.g. 'through " +
    "Sunday') when it's helpful.",
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
const PHOTO_SEND_LIMIT = 4; // inline photos per send_photos call; the rest live in the gallery
const WEB_BASE = "https://askrani.ai";

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
  // image_url is a live reference — pass it to send_photo_urls to show the item.
  const products = (data ?? []).map(
    (r: {
      sku: string | null; name: string; brand: string | null; size: string | null;
      unit: string | null; price: number | null; currency: string | null;
      in_stock: boolean; category: string | null; description?: string | null; image_url?: string | null;
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
      ...(r.description ? { description: r.description } : {}),
      ...(r.image_url ? { image_url: r.image_url } : {}),
    }),
  );
  return { products, count: products.length };
}

async function executeSearchKnowledge(
  db: SupabaseClient,
  store: Store,
  args: Record<string, unknown>,
  today: string | null,
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
  // p_today (store-local date) lets the RPC hide entries outside their effective
  // window — a past sale or a not-yet-active notice never surfaces.
  const { data, error } = await db.rpc("search_knowledge", {
    p_store_id: store.id,
    p_query_embedding: toVectorLiteral(embedding),
    p_limit: SEARCH_KNOWLEDGE_LIMIT,
    p_today: today,
  });
  if (error) {
    console.error(`[tools] search_knowledge: ${error.message}`);
    return { snippets: [], note: "search failed" };
  }
  const snippets = (data ?? []).map(
    (r: {
      kind: string;
      source_ref: string | null;
      chunk_text: string;
      valid_until: string | null;
    }) => ({
      source: r.source_ref,
      kind: r.kind,
      text: r.chunk_text,
      // Present -> a time-limited entry; the bot may mention the deadline.
      ...(r.valid_until ? { valid_until: r.valid_until } : {}),
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

const SEND_IMAGE_DECL: FunctionDeclaration = {
  name: "send_image",
  description:
    "Send the customer ONE picture from the store's uploaded images — its menu, a " +
    "promo flyer, the store front. Use it when they ask to see one ('show me the " +
    "menu'), and you MAY also use it on your own initiative when it genuinely helps — " +
    "occasionally, at most one per reply, never as spam. This only searches images the " +
    "store uploaded; it does NOT reach catalogue product photos. To show a CATALOGUE " +
    "product's picture, pass the image_url that search_products returned to " +
    "send_photo_urls instead. For SEVERAL photos of one subject (e.g. a home listing), " +
    "use send_photos. Pass a short query describing what to show. If it returns " +
    "sent:false, don't mention a picture and never claim you sent one.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What the customer wants to see, e.g. 'menu', 'sweets photo', 'store front'.",
      },
    },
    required: ["query"],
  },
};

const SEND_PHOTOS_DECL: FunctionDeclaration = {
  name: "send_photos",
  description:
    "Send SEVERAL photos the store has on file for one subject — e.g. all the photos " +
    "of a specific home listing, a product, or a space. Use it when the customer wants " +
    "to SEE something and multiple pictures help ('show me the house', 'can I see " +
    "photos of 214 Maple', 'show me the rooms'). It sends a few inline and, when there " +
    "are more, returns a gallery_url containing ALL of them — always share that link " +
    "so the customer can scroll every photo. Pass a query that identifies the subject " +
    "(e.g. '214 Maple Street'). If it returns sent:0, no matching photos are on file — " +
    "don't claim you sent any.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The subject to show photos of, e.g. '214 Maple Street', 'the kitchen'.",
      },
    },
    required: ["query"],
  },
};

const MY_ORDERS_DECL: FunctionDeclaration = {
  name: "my_orders",
  description:
    "Look up THIS customer's own past orders — what they bought, how many, and when. " +
    "Use it whenever they refer to their history rather than naming products: 'send me " +
    "my usual', 'same as last time', 'what did I order last month', 'reorder that', " +
    "'did my order ship'. Read the lines back and, once they confirm, put them in the " +
    "cart with add_to_cart using the sku of each line — adjust any quantity they change. " +
    "Never invent a past order: if it returns none, say you don't see previous orders on " +
    "their account and offer to build one.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "how many recent orders to look at (default 3)" },
    },
    required: [],
  },
};

/**
 * This customer's own order history. Web session ids rotate every session, so a
 * member's past orders are found through every session ever bound to them (plus
 * their phone for WhatsApp) — otherwise "send me my usual" only ever sees today.
 */
async function executeMyOrders(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const limit = Math.min(Math.max(Number(args.limit ?? 3), 1), 5);
  const member = await resolveMember(db, store, sessionId);

  const sessions = new Set<string>([sessionId]);
  let phone = sessionId.startsWith("wa_") ? sessionId.slice(3).replace(/\D/g, "") : "";
  if (member) {
    const { data } = await db
      .from("member_sessions")
      .select("session_id")
      .eq("store_id", store.id)
      .eq("member_id", member.id);
    for (const r of data ?? []) sessions.add((r as { session_id: string }).session_id);
    if (member.phone) phone = member.phone.replace(/\D/g, "");
  }

  const cols = "order_id, timestamp, items_json, total, fulfillment, status";
  const rows: Record<string, unknown>[] = [];
  const { data: bySession } = await db
    .from("orders")
    .select(cols)
    .eq("store_slug", store.slug)
    .in("session_id", [...sessions])
    .order("timestamp", { ascending: false })
    .limit(limit);
  rows.push(...(bySession ?? []));
  if (phone) {
    const { data: byPhone } = await db
      .from("orders")
      .select(cols)
      .eq("store_slug", store.slug)
      .eq("customer_phone", phone)
      .order("timestamp", { ascending: false })
      .limit(limit);
    rows.push(...(byPhone ?? []));
  }

  // Merge the two lookups (a customer can appear under both), newest first.
  const seen = new Set<string>();
  const orders = rows
    .filter((o) => {
      const id = String(o.order_id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit)
    .map((o) => ({
      order_ref: o.order_id,
      placed: String(o.timestamp).slice(0, 10),
      status: o.status,
      fulfillment: o.fulfillment,
      total: o.total,
      lines: (Array.isArray(o.items_json) ? o.items_json : []).map((l: Record<string, unknown>) => ({
        sku: l.sku,
        name: l.name,
        quantity: l.quantity,
      })),
    }));

  if (orders.length === 0) {
    return {
      orders: [],
      note: "No previous orders on this account — don't imply otherwise; offer to build an order instead.",
    };
  }
  return {
    orders,
    note: "Their real history. Read the lines back and only add to the cart after they confirm.",
  };
}

const SHOW_PRODUCTS_DECL: FunctionDeclaration = {
  name: "show_products",
  description:
    "Open the customer's catalogue view FILTERED to what you're talking about, so " +
    "they can browse and tap instead of reading a long list. Use it whenever they " +
    "ask to see, browse or compare a group of things ('show me your GRAV pipes', " +
    "'what disposables do you have under $50', 'show me the kratom capsules'), " +
    "especially when there are more matches than you'd list in a message. Pass any " +
    "combination of a free-text query, categories, brands, a price range, or " +
    "in_stock — use the exact category and brand names the catalogue uses. Say one " +
    "short line about what you're showing; do NOT also list every item. On WhatsApp " +
    "this sends a browse link instead of a grid, which is fine — call it the same way.",
  parameters: {
    type: "object",
    properties: {
      q: { type: "string", description: "free-text, e.g. 'mini beaker' or 'coconut charcoal'" },
      categories: { type: "array", items: { type: "string" }, description: "exact category names" },
      brands: { type: "array", items: { type: "string" }, description: "exact brand names" },
      price_min: { type: "number" },
      price_max: { type: "number" },
      in_stock: { type: "boolean", description: "true = only what's on the shelf" },
      note: { type: "string", description: "optional short caption, e.g. 'GRAV glass, in stock'" },
    },
    required: [],
  },
};

const SEND_PHOTO_URLS_DECL: FunctionDeclaration = {
  name: "send_photo_urls",
  description:
    "Show the customer photos from image URLs that another tool returned — a " +
    "CATALOGUE product's image_url from search_products, or e.g. an MLS listing's " +
    "photos (its media/photos list). This is THE way to show a product's picture: " +
    "search_products first, then pass the image_url values it returned. Pass the URLs " +
    "and an optional caption; it sends a few inline. Use it right after a product or " +
    "listing search returns image URLs, to actually show the pictures. Only pass URLs " +
    "a tool returned — never invent or guess an image URL.",
  parameters: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "Image URLs returned by a tool (e.g. a listing's media list).",
      },
      caption: { type: "string", description: "Optional short caption, e.g. the address." },
    },
    required: ["urls"],
  },
};

type ImageDoc = { source_ref: string | null; source_path: string; chunk_text: string | null };

/** All of a store's image-sourced KB docs, ranked by keyword overlap on the
 *  query (title + extracted text). Only images qualify — a PDF can't be sent. */
async function rankImages(
  db: SupabaseClient,
  store: Store,
  query: string,
): Promise<{ doc: ImageDoc; score: number }[]> {
  const { data: docs } = await db
    .from("knowledge_index")
    .select("source_ref, source_path, chunk_text")
    .eq("store_id", store.id)
    .eq("kind", "document_chunk")
    .not("source_path", "is", null)
    .like("source_mime", "image/%");
  if (!docs || docs.length === 0) return [];
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return (docs as ImageDoc[])
    .map((doc) => {
      const hay = `${doc.source_ref ?? ""} ${doc.chunk_text ?? ""}`.toLowerCase();
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
      return { doc, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** Record one image URL as an outbound thread message (panel + web Realtime),
 *  and — on WhatsApp — also push it over the WhatsApp media API. The URL must be
 *  publicly reachable (a signed KB URL, or a connector-provided public photo). */
/** Deliver ONE image to a session — records it (web delivery) or sends it via
 *  WhatsApp. Exported so the conversation layer can put a few product photos in
 *  a WhatsApp chat when it opens a catalogue view (otherwise WhatsApp only gets
 *  a bare link and the chat feels empty). */
export async function recordAndSend(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  url: string,
  caption: string,
): Promise<boolean> {
  const isWeb = sessionId.startsWith("web_");
  const phone = sessionId.startsWith("wa_") ? sessionId.slice(3) : sessionId;
  const threadId = isWeb ? `thr_${sessionId}_${store.slug}` : `thr_${phone}_${store.slug}`;
  const { error } = await db.from("thread_messages").insert({
    message_id: `msg_img_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: isWeb ? sessionId : phone,
    direction: "outbound",
    sender: "agent",
    text: caption || null,
    media_url: url,
    kind: "message",
  });
  if (isWeb) return !error; // the thread message IS the delivery

  const token = await getStoreAccessToken(db, store.id);
  if (!token || !store.whatsapp_phone_number_id) return false;
  return await sendImage(token, store.whatsapp_phone_number_id, phone, url, caption || "");
}

/** Sign a KB image (7-day URL — still loads when staff review later) and send it. */
async function deliverImage(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  doc: ImageDoc,
): Promise<boolean> {
  const { data: signed } = await db.storage.from("kb").createSignedUrl(doc.source_path, 60 * 60 * 24 * 7);
  if (!signed?.signedUrl) return false;
  return recordAndSend(db, store, sessionId, signed.signedUrl, doc.source_ref ?? "");
}

/** A shareable gallery link (all photos matching the query) using the store's
 *  primary public token. Null if the store has no public token. */
async function galleryUrl(db: SupabaseClient, store: Store, query: string): Promise<string | null> {
  const { data } = await db
    .from("store_tokens")
    .select("token")
    .eq("store_id", store.id)
    .eq("active", true)
    .is("listing_ref", null)
    .order("created_at", { ascending: true })
    .limit(1);
  const token = data?.[0]?.token;
  if (!token) return null;
  return `${WEB_BASE}/g/${store.slug}?t=${token}&q=${encodeURIComponent(query)}`;
}

/** Send the single best-matching image the store uploaded. */
async function executeSendImage(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = String(args.query ?? "").trim();
  const ranked = await rankImages(db, store, query);
  if (ranked.length === 0) return { sent: false, note: "the store has no picture on file to send" };
  const best = ranked[0].doc;
  const ok = await deliverImage(db, store, sessionId, best);
  return ok
    ? { sent: true, image: best.source_ref }
    : { sent: false, note: "could not send the image", image: best.source_ref };
}

/** Send several photos matching a subject, plus a gallery link for the rest. */
async function executeSendPhotos(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = String(args.query ?? "").trim();
  const ranked = await rankImages(db, store, query);
  const matches = ranked.filter((r) => r.score > 0).map((r) => r.doc);
  if (matches.length === 0) return { sent: 0, note: "no matching photos on file" };

  let sent = 0;
  const captions: string[] = [];
  for (const doc of matches.slice(0, PHOTO_SEND_LIMIT)) {
    if (await deliverImage(db, store, sessionId, doc)) {
      sent++;
      if (doc.source_ref) captions.push(doc.source_ref);
    }
  }
  const gallery = matches.length > sent ? await galleryUrl(db, store, query) : null;
  return {
    sent,
    total: matches.length,
    photos: captions,
    ...(gallery ? { gallery_url: gallery } : {}),
  };
}

/**
 * Push a filtered catalogue view to the customer's screen. Returns a SUMMARY to
 * the model (count + a few names, so it can speak about what it just showed)
 * and stashes the filter in `ui` for the client to render.
 */
async function executeShowProducts(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  ui: UiDirectives,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const filter = coerceFilter(args);
  filter.limit = 24;
  // resolveMember reads the channel off the session id itself (wa_ / web_).
  const showPrices = await maySeePrices(db, store, { sessionId });
  let page;
  try {
    page = await browseProducts(db, store, filter, showPrices);
    // The model guesses brand/category names from the conversation, so an exact
    // filter can miss ("GRAV" when the catalogue never filled brand in). Rather
    // than show an empty grid, fold the guess into the search text and retry.
    if (page.total === 0 && (filter.brands?.length || filter.categories?.length)) {
      const guessed = [...(filter.brands ?? []), ...(filter.categories ?? [])].join(" ");
      const relaxed: CatalogFilter = {
        ...filter,
        brands: null,
        categories: null,
        q: [filter.q, guessed].filter(Boolean).join(" ").trim(),
      };
      const retry = await browseProducts(db, store, relaxed, showPrices);
      if (retry.total > 0) {
        filter.brands = null;
        filter.categories = null;
        filter.q = relaxed.q;
        page = retry;
      }
    }
  } catch (e) {
    console.error(`[tools] show_products: ${e instanceof Error ? e.message : e}`);
    return { shown: 0, note: "couldn't open the catalogue view" };
  }
  if (page.total === 0) {
    return { shown: 0, note: "nothing matched — don't claim you showed anything; offer to search differently" };
  }
  const note = typeof args.note === "string" ? args.note.slice(0, 80) : undefined;
  ui.catalog_view = { filter, total: page.total, note, prices_hidden: page.prices_hidden };
  return {
    shown: page.total,
    showing: describeFilter(filter) || "the catalogue",
    // Enough for the model to talk about the set without listing it all.
    sample: page.items.slice(0, 5).map((i) => i.name),
    prices_hidden: page.prices_hidden,
    note: page.prices_hidden
      ? "Opened their catalogue view. Prices are hidden — they are not a verified account."
      : "Opened their catalogue view, filtered. Say one short line about it; don't list every item.",
  };
}

/** Show photos from URLs a connector returned (e.g. an MLS Media list). */
async function executeSendPhotoUrls(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const raw = Array.isArray(args.urls) ? args.urls : [];
  const urls = raw.map((u) => String(u)).filter((u) => /^https:\/\/\S+$/.test(u));
  const caption = String(args.caption ?? "").trim();
  if (urls.length === 0) return { sent: 0, note: "no valid image URLs" };
  let sent = 0;
  for (const url of urls.slice(0, PHOTO_SEND_LIMIT)) {
    if (await recordAndSend(db, store, sessionId, url, caption)) sent++;
  }
  return { sent, total: urls.length };
}

const START_SHARE_EARN_DECL: FunctionDeclaration = {
  name: "start_share_earn",
  description:
    "Call this when the customer wants to SHARE the store with friends, REFER someone, " +
    "or asks about a 'share and earn' / referral / invite offer. It creates THEIR personal " +
    "share card + link and sends the card into the chat; when a friend orders through it, " +
    "the customer earns store credit. Only call it if they show interest in sharing/referring " +
    "— never pitch it unprompted. After it runs, tell them in one short line what they and " +
    "their friend each get. If it returns no_active_campaign, there is no offer running — do " +
    "not promise any reward.",
  parameters: { type: "object", properties: {}, required: [] },
};

/** Mint (or reuse) the customer's referral link, compose their branded card, and
 *  send it into the chat. When a friend orders through the link, the initiator is
 *  credited (see referral.ts attributeReferralOrder). Card is best-effort. */
async function executeStartShareEarn(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  _args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // 1. Identify (or lightly provision) the sharer.
  let initiatorId = (await resolveMember(db, store, sessionId))?.id ?? null;
  if (!initiatorId && sessionId.startsWith("wa_")) {
    const phone = sessionId.slice(3);
    const ins = await db.from("store_members").insert({ store_id: store.id, phone }).select("id").maybeSingle();
    initiatorId = ins.data?.id ?? (await resolveMember(db, store, sessionId))?.id ?? null;
  }
  if (!initiatorId) {
    return {
      ok: false,
      reason: "needs_identity",
      note: "Can't start sharing without knowing who they are. Ask them to verify their identity (or continue on WhatsApp), then try again.",
    };
  }

  // 2. The store's active give-and-get campaign + its amounts.
  const { data: rule } = await db
    .from("reward_rules")
    .select("campaign_id, amount_cents, recipient_amount_cents, recipient_min_order_cents, reward_campaigns!inner(status, store_id)")
    .eq("trigger", "referral_first_order")
    .eq("reward_campaigns.store_id", store.id)
    .eq("reward_campaigns.status", "active")
    .limit(1)
    .maybeSingle();
  if (!rule) {
    return { ok: false, reason: "no_active_campaign", note: "No share-and-earn offer is running. Don't promise a reward." };
  }
  // deno-lint-ignore no-explicit-any
  const r = rule as any;

  // 3. Their link.
  const link = await getOrCreateReferralLink(db, { campaignId: r.campaign_id, initiatorMemberId: initiatorId });
  const url = trackedUrl(link.code);

  const recip = Math.round(Number(r.recipient_amount_cents ?? 0)) / 100;
  const minOrder = Math.round(Number(r.recipient_min_order_cents ?? 0)) / 100;
  const initReward = Math.round(Number(r.amount_cents ?? 0)) / 100;
  const storeName = store.store_display_name || "our store";
  const headline = recip > 0 ? `$${recip} off your first order` : "A gift for you";

  // 4. Compose + deliver the card (best-effort — fall back to a text+link handover).
  let cardDelivered = false;
  try {
    const cardUrl = await composeAndStoreCard(db, store, link, {
      storeName,
      headline,
      sub: "A friend sent you this",
    });
    const caption = `${headline} at ${storeName}${minOrder > 0 ? ` (min $${minOrder} order)` : ""} — order here: ${url}`;
    cardDelivered = await recordAndSend(db, store, sessionId, cardUrl, caption);
  } catch (e) {
    console.error(`[tools] start_share_earn card: ${e instanceof Error ? e.message : e}`);
  }

  return {
    ok: true,
    link: url,
    friend_gets: headline,
    you_get: initReward > 0 ? `$${initReward} store credit when a friend orders` : "a reward when a friend orders",
    card_delivered: cardDelivered,
    note: cardDelivered
      ? "Sent them their share card + link. Tell them to forward it to friends; say in one line what they and their friend each get."
      : "Give them their link to share and say in one line what they and their friend each get.",
  };
}

const MY_CREDIT_DECL: FunctionDeclaration = {
  name: "my_credit",
  description:
    "Check THIS customer's store-credit balance — what they've earned (e.g. from sharing/referrals) " +
    "and can spend in store. Use it when they ask 'how much credit do I have', 'what's my balance', " +
    "'do I have any rewards', or before helping them redeem. Report the amount plainly; if they have " +
    "a balance and want to use it, call redeem_credit next. Never invent a balance.",
  parameters: { type: "object", properties: {}, required: [] },
};

const REDEEM_CREDIT_DECL: FunctionDeclaration = {
  name: "redeem_credit",
  description:
    "Give the customer a redemption CODE to use their store credit in store right now. Use it when " +
    "they say they want to use / redeem / spend their credit. It returns a short code they show at " +
    "checkout — staff confirm it and apply the discount on the store's own register (you never process " +
    "payment). Only call it if they have a balance (check my_credit if unsure). Then tell them the code, " +
    "the amount, and that it's good for about 15 minutes.",
  parameters: {
    type: "object",
    properties: {
      amount: { type: "number", description: "optional dollars they want to redeem; omit to make the full balance available" },
    },
    required: [],
  },
};

/** This customer's spendable store-credit balance (+ what's still in the hold
 *  window, and the soonest expiry) so Rani can answer "how much credit do I have". */
async function executeMyCredit(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  _args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const member = await resolveMember(db, store, sessionId);
  if (!member?.id) {
    return { ok: false, reason: "needs_identity", note: "Can't check credit without knowing who they are — ask them to verify (or continue on WhatsApp)." };
  }
  const balanceCents = await rewardBalanceCents(db, store.id, member.id);
  const { data: held } = await db
    .from("reward_ledger")
    .select("amount_cents")
    .eq("store_id", store.id).eq("member_id", member.id).eq("status", "held");
  const onTheWayCents = (held ?? []).reduce((s, r) => s + Number((r as { amount_cents: number }).amount_cents || 0), 0);
  const { data: soon } = await db
    .from("reward_ledger")
    .select("expires_at")
    .eq("store_id", store.id).eq("member_id", member.id).eq("status", "released")
    .not("expires_at", "is", null)
    .order("expires_at", { ascending: true }).limit(1).maybeSingle();
  return {
    ok: true,
    balance_usd: balanceCents / 100,
    on_the_way_usd: onTheWayCents > 0 ? onTheWayCents / 100 : undefined,
    soonest_expiry: soon?.expires_at ?? undefined,
    note: balanceCents > 0
      ? "They can spend this in store. If they want to use it now, call redeem_credit."
      : onTheWayCents > 0
        ? "No spendable credit yet — some is still in the hold window and will be ready soon."
        : "They have no store credit yet. Don't imply they do.",
  };
}

/** Issue a redemption pass (a 4-digit code) for up to the member's balance. Staff
 *  confirm it in store; the discount is applied on the store's own register. */
async function executeRedeemCredit(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const member = await resolveMember(db, store, sessionId);
  if (!member?.id) {
    return { ok: false, reason: "needs_identity", note: "Can't redeem without knowing who they are — ask them to verify (or continue on WhatsApp)." };
  }
  const requestedCents = args.amount != null && Number.isFinite(Number(args.amount))
    ? Math.round(Number(args.amount) * 100)
    : undefined;
  const pass = await issueRedemptionPass(db, {
    storeId: store.id,
    memberId: member.id,
    requestedCents,
    firstName: member.name ?? undefined,
  });
  if (!pass) {
    return { ok: false, reason: "no_balance", note: "They have no store credit to redeem right now — don't give a code." };
  }
  const mins = Math.max(1, Math.round((new Date(pass.expires_at).getTime() - Date.now()) / 60000));
  const amount = pass.amount_cents / 100;
  return {
    ok: true,
    code: pass.code4,
    amount_usd: amount,
    expires_in_minutes: mins,
    note: `Give them their code ${pass.code4} for up to $${amount.toFixed(2)}. They show it at checkout within ~${mins} min; staff confirm it and apply the discount on the register. Say the code and amount clearly.`,
  };
}

const SUBMIT_POST_DECL: FunctionDeclaration = {
  name: "submit_post_url",
  description:
    "Use this when the customer wants to earn store credit by POSTING about the store on social media " +
    "(Instagram / YouTube / Facebook), or tells you they already posted. FIRST call it with NO url to get " +
    "the current offer and rules — then tell them they must include the required disclosure tag (#ad or " +
    "#gifted) in the post. Once they confirm the tag is there AND give you the post link, call it again " +
    "with url + disclosure_confirmed=true to submit it for the store's review. Credit is NOT instant — it " +
    "lands after the store approves the post. If it returns no_active_offer, there's no posting reward " +
    "running; do not promise one.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "the post's public link (omit on the first call to just get the offer)" },
      platform: { type: "string", description: "instagram | youtube | facebook, if known" },
      format: { type: "string", description: "reel | post | story, if the customer says which they made (some offers pay differently per format)" },
      disclosure_confirmed: { type: "boolean", description: "true only once the customer confirms the post includes #ad or #gifted" },
    },
    required: [],
  },
};

/** Explain the active post-for-credit offer and/or submit a customer's post for
 *  review. The reward accrues later, when the owner approves it. */
async function executeSubmitPost(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const camp = await activePostCampaign(db, store.id);
  if (!camp || !camp.rules.length) {
    return { ok: false, reason: "no_active_offer", note: "No post-for-credit offer is running. Don't promise a reward." };
  }
  const offers = camp.rules.map(describeRuleOffer);          // one payout line per platform
  const platforms = camp.rules.map((r) => r.platform).filter(Boolean);

  const url = String(args.url ?? "").trim();
  if (!url) {
    // Hand over any ready-made media the owner uploaded for people to post.
    let mediaSent = 0;
    for (const m of camp.shareMedia.slice(0, PHOTO_SEND_LIMIT)) {
      if (/^https:\/\/\S+$/.test(m.url) && await recordAndSend(db, store, sessionId, m.url, m.label ?? "")) mediaSent++;
    }
    const promo = (camp.promoContext ?? "").trim();
    return {
      ok: true,
      has_offer: true,
      offers,
      platforms,
      promote: promo || undefined,
      media_sent: mediaSent,
      note: `Post-for-credit offers by platform — ${offers.join(" · ")}.${promo ? ` The store wants posts about: ${promo} — tell them this is what to feature.` : ""} The post must include the required #ad or #gifted tag.${mediaSent > 0 ? " I just sent them ready-to-post images they can share." : ""} Tell them the offer for whichever platform they'll use, then ask for the post link and call this again with url + disclosure_confirmed=true. Different platforms/formats can pay differently.`,
    };
  }

  // Resolve the platform (their hint, else from the link) to quote the right offer.
  const platform = (args.platform ? String(args.platform) : platformFromUrl(url) ?? "").toLowerCase() || null;
  const rule = pickRuleForPlatform(camp.rules, platform);
  const earns = rule ? describeRuleOffer(rule) : null;

  const res = await createPostSubmission(db, store, sessionId, {
    postUrl: url,
    platform: args.platform ? String(args.platform) : null, // createPostSubmission infers from the URL if null
    format: args.format ? String(args.format).toLowerCase() : null,
    disclosureConfirmed: args.disclosure_confirmed === true,
  });
  if (!res.ok) return { ok: false, reason: res.reason, note: res.note };
  return { ok: true, submitted: true, earns, note: res.note };
}

/** Build the toolset bound to a store + session context. Cart/order tools are
 *  attached only when ordering is enabled for the store (Agent Setup). */
export function buildToolset(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  ordersEnabled: boolean,
  hasProposal = false,
  catalogEnabled = false,
  today: string | null = null,
  integrations: StoreIntegration[] = [],
  requestTypes: RequestType[] = [],
  ui: UiDirectives = {},
): Toolset {
  const executors: Record<string, ToolExecutor> = {
    search_products: (args) => executeSearchProducts(db, store, args),
    show_products: (args) => executeShowProducts(db, store, sessionId, ui, args),
    my_orders: (args) => executeMyOrders(db, store, sessionId, args),
    start_share_earn: (args) => executeStartShareEarn(db, store, sessionId, args),
    my_credit: (args) => executeMyCredit(db, store, sessionId, args),
    redeem_credit: (args) => executeRedeemCredit(db, store, sessionId, args),
    submit_post_url: (args) => executeSubmitPost(db, store, sessionId, args),
    search_knowledge: (args) => executeSearchKnowledge(db, store, args, today),
    send_image: (args) => executeSendImage(db, store, sessionId, args),
    send_photos: (args) => executeSendPhotos(db, store, sessionId, args),
    send_photo_urls: (args) => executeSendPhotoUrls(db, store, sessionId, args),
    escalate_to_owner: (args) => executeEscalate(db, store, sessionId, args),
    file_request: (args) => executeFileRequest(db, store, sessionId, requestTypes, args),
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
  // search_products (which returns prices) is attached ONLY in catalogue mode —
  // in request mode the bot has no price-returning tool, so it cannot quote a price.
  const declarations: FunctionDeclaration[] = [
    SEARCH_KNOWLEDGE_DECL,
    SEND_IMAGE_DECL,
    SEND_PHOTOS_DECL,
    SEND_PHOTO_URLS_DECL,
    ESCALATE_DECL,
  ];
  // Generic request capture — offered only when the store has defined request
  // types (e.g. "Career interest", "Callback"). Nothing here is use-case-specific.
  if (requestTypes.length) declarations.push(fileRequestDeclaration(requestTypes));
  if (catalogEnabled) declarations.push(SEARCH_PRODUCTS_DECL, SHOW_PRODUCTS_DECL);
  if (ordersEnabled) declarations.push(MY_ORDERS_DECL, START_SHARE_EARN_DECL, MY_CREDIT_DECL, REDEEM_CREDIT_DECL, SUBMIT_POST_DECL);
  if (ordersEnabled) {
    if (catalogEnabled) declarations.push(ADD_TO_CART_DECL); // priced catalog add
    declarations.push(
      ADD_REQUEST_ITEM_DECL,
      VIEW_CART_DECL,
      REMOVE_FROM_CART_DECL,
      CLEAR_CART_DECL,
      PLACE_ORDER_DECL,
    );
    if (hasProposal) declarations.push(CONFIRM_PROPOSAL_DECL, CANCEL_PROPOSAL_DECL);
  }
  // Per-store custom connectors (Phase 6). Additive: a core tool is never
  // shadowed, and stores with no integrations reach none of this.
  for (const integ of integrations) {
    if (executors[integ.name]) continue; // never override a built-in tool
    executors[integ.name] = (args) => executeIntegration(integ, store, sessionId, args);
    declarations.push(integrationDeclaration(integ) as FunctionDeclaration);
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
