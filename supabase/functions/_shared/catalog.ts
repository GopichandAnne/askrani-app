// Catalogue browsing — the one place that answers "what may this visitor see?"
//
// Every browsing surface (web grid, the chat's show_products tool, WhatsApp
// lists and browse links) goes through here, so the price gate cannot be true
// in one surface and false in another. The gate used to live only in the store's
// prompt, which bound the model and nothing else — the overlay called the menu
// endpoint directly and handed wholesale pricing to anyone with the link.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { embedQuery, toVectorLiteral } from "./embeddings.ts";

/** The shared view state. The web grid, the bot and a browse link all speak this. */
export type CatalogFilter = {
  q?: string | null;
  categories?: string[] | null;
  brands?: string[] | null;
  price_min?: number | null;
  price_max?: number | null;
  in_stock?: boolean | null;
  skus?: string[] | null;
  limit?: number;
  offset?: number;
};

export type CatalogFacets = {
  categories: { value: string; count: number }[];
  brands: { value: string; count: number }[];
  price: { min: number; max: number } | null;
  in_stock: number;
};

export type CatalogPage = {
  total: number;
  prices_hidden: boolean;
  items: Record<string, unknown>[];
  facets: CatalogFacets;
};

/** 'public' (default) = anyone sees prices. 'members' = verified members only. */
export async function priceVisibility(
  db: SupabaseClient,
  storeId: string,
): Promise<"public" | "members"> {
  const { data } = await db
    .from("agent_config")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "price_visibility")
    .maybeSingle();
  return String(data?.value ?? "").toLowerCase() === "members" ? "members" : "public";
}

/** What the overlay/tab should be called: Menu, Catalogue, Listings… */
export async function catalogLabel(db: SupabaseClient, storeId: string): Promise<string> {
  const { data } = await db
    .from("agent_config")
    .select("value")
    .eq("store_id", storeId)
    .eq("key", "catalog_label")
    .maybeSingle();
  const v = String(data?.value ?? "").trim();
  return v || "Menu";
}

/** Is this web session bound to a verified member of this store? */
export async function sessionIsMember(
  db: SupabaseClient,
  storeId: string,
  sessionId: string,
): Promise<boolean> {
  if (!sessionId) return false;
  const { data } = await db
    .from("member_sessions")
    .select("member_id")
    .eq("session_id", sessionId)
    .eq("store_id", storeId)
    .maybeSingle();
  return !!data?.member_id;
}

/** A WhatsApp sender is identified by their phone, not a session. */
export async function phoneIsMember(
  db: SupabaseClient,
  storeId: string,
  phone: string,
): Promise<boolean> {
  if (!phone) return false;
  const { data } = await db
    .from("store_members")
    .select("id")
    .eq("store_id", storeId)
    .eq("phone", phone)
    .eq("active", true)
    .eq("blocked", false)
    .maybeSingle();
  return !!data?.id;
}

/**
 * Resolve the price gate for a visitor. Returns true when prices may be shown.
 * Callers must NEVER take this from the client.
 */
export async function maySeePrices(
  db: SupabaseClient,
  store: Store,
  opts: { sessionId?: string; phone?: string },
): Promise<boolean> {
  if ((await priceVisibility(db, store.id)) === "public") return true;
  if (opts.sessionId && (await sessionIsMember(db, store.id, opts.sessionId))) return true;
  if (opts.phone && (await phoneIsMember(db, store.id, opts.phone))) return true;
  return false;
}

/** Run a filtered, faceted, gate-aware page of the catalogue. */
export async function browseProducts(
  db: SupabaseClient,
  store: Store,
  filter: CatalogFilter,
  showPrices: boolean,
): Promise<CatalogPage> {
  const q = (filter.q ?? "").trim();
  // Only pay for an embedding when there's a real free-text query — a plain
  // category tap doesn't need semantics. A failed embed degrades to text search
  // rather than failing the browse.
  let embedding: string | null = null;
  if (q.length >= 3) {
    try {
      embedding = toVectorLiteral(await embedQuery(q));
    } catch (e) {
      console.error(`[catalog] embed failed, falling back to text: ${e instanceof Error ? e.message : e}`);
    }
  }

  const { data, error } = await db.rpc("browse_products", {
    p_store_id: store.id,
    p_query: q || null,
    p_query_embedding: embedding,
    p_categories: filter.categories?.length ? filter.categories : null,
    p_brands: filter.brands?.length ? filter.brands : null,
    p_price_min: filter.price_min ?? null,
    p_price_max: filter.price_max ?? null,
    p_in_stock: filter.in_stock ?? null,
    p_skus: filter.skus?.length ? filter.skus : null,
    p_limit: Math.min(Math.max(filter.limit ?? 40, 1), 60),
    p_offset: Math.max(filter.offset ?? 0, 0),
    p_show_prices: showPrices,
  });
  if (error) throw new Error(`browse_products: ${error.message}`);
  return data as CatalogPage;
}

/** Normalise whatever a client/model sent into a safe filter. */
export function coerceFilter(raw: Record<string, unknown> | undefined | null): CatalogFilter {
  const r = raw ?? {};
  const arr = (v: unknown): string[] | null => {
    if (typeof v === "string" && v.trim()) return [v.trim()];
    if (Array.isArray(v)) {
      const out = v.map((x) => String(x).trim()).filter(Boolean);
      return out.length ? out : null;
    }
    return null;
  };
  // Number(null) is 0, not NaN — so a plain Number() here silently turned
  // "price_max: null" into "price_max: 0" (matching nothing) and "limit: null"
  // into "limit: 0" (returning nothing). Absent must stay absent.
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    q: typeof r.q === "string" ? r.q.slice(0, 120) : null,
    categories: arr(r.categories),
    brands: arr(r.brands),
    price_min: num(r.price_min),
    price_max: num(r.price_max),
    in_stock: typeof r.in_stock === "boolean" ? r.in_stock : null,
    skus: arr(r.skus),
    limit: num(r.limit) ?? 40,
    offset: num(r.offset) ?? 0,
  };
}

const WEB_BASE = "https://askrani.ai";

/** base64url — WhatsApp mangles nothing, but `+` and `/` in a URL do. */
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A link to the store's catalogue, pre-filtered. This is how a filtered view
 * reaches a channel with no UI of its own (WhatsApp): the filter travels in the
 * URL and the web grid picks it up.
 *
 * The filter selects what to SHOW and nothing more — the price gate is enforced
 * server-side on every browse, so an edited link cannot reveal pricing. Returns
 * null when the store has no usable public token.
 */
export async function browseLink(
  db: SupabaseClient,
  store: Store,
  filter: CatalogFilter,
): Promise<string | null> {
  const { data } = await db
    .from("store_tokens")
    .select("token")
    .eq("store_id", store.id)
    .eq("active", true)
    .is("listing_ref", null) // a listing token is scoped to one home, not the catalogue
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const token = data?.token;
  if (!token) return null;

  // Send only the meaningful keys — a URL full of nulls is noise.
  const slim: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (k === "limit" || k === "offset") continue;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    slim[k] = v;
  }
  const v = b64url(JSON.stringify(slim));
  return `${WEB_BASE}/s/${store.slug}?t=${token}&v=${v}`;
}

/** A short human summary of a filter — for chat copy and link previews. */
export function describeFilter(f: CatalogFilter): string {
  const bits: string[] = [];
  if (f.q) bits.push(`"${f.q}"`);
  if (f.categories?.length) bits.push(f.categories.join(" / "));
  if (f.brands?.length) bits.push(f.brands.join(" / "));
  if (f.price_max != null && f.price_min != null) bits.push(`$${f.price_min}–$${f.price_max}`);
  else if (f.price_max != null) bits.push(`under $${f.price_max}`);
  else if (f.price_min != null) bits.push(`over $${f.price_min}`);
  if (f.in_stock) bits.push("in stock");
  return bits.join(" · ");
}
