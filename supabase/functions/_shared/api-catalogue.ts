// Authenticated API catalogue pull for the intelligent import.
//
// Fetches a JSON endpoint WITH auth headers (the thing a plain URL import can't
// do), follows pagination, and either maps items to products DETERMINISTICALLY
// (when a field map is given — exact, no LLM, no token cost) or returns the raw
// JSON text for the existing LLM extractor to handle (no map given).

export type ExtractedProduct = {
  name: string;
  category: string;
  description: string;
  sku: string;
  image_url: string;
  price: number | null;
};

export type ApiSource = {
  url: string;
  headers?: Record<string, string>;
  /** Dot-path to the product array in the response (e.g. "data.items"). */
  list_path?: string;
  /** Which item key (dot-path ok) holds each product field. Omit -> LLM extract. */
  map?: Partial<Record<"name" | "price" | "sku" | "category" | "description" | "image_url", string>>;
  paginate?: { next_path?: string; page_param?: string; start?: number; max_pages?: number };
};

export type PullResult =
  | { kind: "products"; products: ExtractedProduct[] }
  | { kind: "text"; text: string } // hand to the LLM extractor
  | { kind: "error"; error: string };

/** Navigate a dot-path (e.g. "data.items", "meta.next") in a JSON value. */
export function getByPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  // deno-lint-ignore no-explicit-any
  let cur: any = obj;
  for (const key of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** First array value found in an object (shallow) — for when no list_path is given. */
function firstArray(obj: unknown): unknown[] | null {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

function listFrom(data: unknown, listPath?: string): unknown[] | null {
  if (listPath) {
    const v = getByPath(data, listPath);
    return Array.isArray(v) ? v : null;
  }
  return firstArray(data);
}

/** LLMs mangle numbers — parse the price ourselves from whatever the field holds. */
export function coercePrice(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const m = String(raw ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const str = (v: unknown): string => (v == null ? "" : String(v));

export function mapItem(item: unknown, map: NonNullable<ApiSource["map"]>): ExtractedProduct {
  return {
    name: str(getByPath(item, map.name)),
    category: str(getByPath(item, map.category)),
    description: str(getByPath(item, map.description)),
    sku: str(getByPath(item, map.sku)),
    image_url: str(getByPath(item, map.image_url)),
    price: coercePrice(getByPath(item, map.price)),
  };
}

export async function pullApiCatalogue(
  api: ApiSource,
  fetchImpl: typeof fetch = fetch,
): Promise<PullResult> {
  const headers = api.headers ?? {};
  const maxPages = Math.min(Math.max(api.paginate?.max_pages ?? 20, 1), 50);

  // No field map -> fetch one page, hand the raw JSON to the LLM extractor.
  if (!api.map || Object.keys(api.map).length === 0) {
    try {
      const r = await fetchImpl(api.url, { headers });
      if (!r.ok) return { kind: "error", error: `API returned HTTP ${r.status}` };
      return { kind: "text", text: await r.text() };
    } catch (e) {
      return { kind: "error", error: `Couldn't reach that API: ${e instanceof Error ? e.message : e}` };
    }
  }

  // Field map -> deterministic JSON -> products, following pagination.
  const items: unknown[] = [];
  let nextUrl: string | null = api.url;
  let page = api.paginate?.start ?? 1;
  try {
    for (let i = 0; i < maxPages && nextUrl; i++) {
      const u = api.paginate?.page_param
        ? `${api.url}${api.url.includes("?") ? "&" : "?"}${api.paginate.page_param}=${page}`
        : nextUrl;
      const r = await fetchImpl(u, { headers });
      if (!r.ok) {
        if (i === 0) return { kind: "error", error: `API returned HTTP ${r.status}` };
        break;
      }
      let data: unknown;
      try {
        data = JSON.parse(await r.text());
      } catch {
        return { kind: "error", error: "API did not return valid JSON." };
      }
      const list = listFrom(data, api.list_path);
      if (!list) {
        if (i === 0) return { kind: "error", error: "Couldn't find a product list — check the items path." };
        break;
      }
      items.push(...list);
      if (api.paginate?.next_path) {
        const nx = getByPath(data, api.paginate.next_path);
        nextUrl = nx ? String(nx) : null;
      } else if (api.paginate?.page_param) {
        if (list.length === 0) break;
        page++;
        nextUrl = api.url;
      } else {
        break; // single page
      }
    }
  } catch (e) {
    return { kind: "error", error: `Couldn't reach that API: ${e instanceof Error ? e.message : e}` };
  }

  const products = items.map((it) => mapItem(it, api.map!)).filter((p) => p.name.trim());
  if (products.length === 0) return { kind: "error", error: "No products mapped — check the field mapping." };
  return { kind: "products", products };
}
