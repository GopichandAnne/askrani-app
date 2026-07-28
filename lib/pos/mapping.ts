import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PosCatalogItem, PosProviderId } from "./types";
import { getAdapter } from "./registry";
import { getValidAccessToken, getPosCreds } from "./credentials";

/** Our sku → the POS item id, for a store+provider. */
export async function getItemMap(provider: PosProviderId, storeId: string): Promise<Record<string, string>> {
  const db = createAdminClient();
  const { data } = await db
    .from("pos_item_map")
    .select("sku, external_id")
    .eq("store_id", storeId)
    .eq("provider", provider);
  const map: Record<string, string> = {};
  for (const r of data ?? []) if (r.sku && r.external_id) map[r.sku] = r.external_id;
  return map;
}

export async function countMapped(provider: PosProviderId, storeId: string): Promise<number> {
  const db = createAdminClient();
  const { count } = await db
    .from("pos_item_map")
    .select("sku", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("provider", provider);
  return count ?? 0;
}

/** Normalize a product/menu name for fuzzy matching (case/space/punct-insensitive). */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Pure auto-matcher: pair our products to POS catalog items by normalized name. */
export function autoMatch(
  products: { sku: string; name: string }[],
  catalog: PosCatalogItem[],
): { sku: string; external_id: string; external_name: string }[] {
  const byName = new Map<string, PosCatalogItem>();
  for (const c of catalog) {
    const key = normalize(c.name);
    if (key && !byName.has(key)) byName.set(key, c); // first wins on dup names
  }
  const out: { sku: string; external_id: string; external_name: string }[] = [];
  for (const p of products) {
    if (!p.sku || !p.name) continue;
    const hit = byName.get(normalize(p.name));
    if (hit) out.push({ sku: p.sku, external_id: hit.id, external_name: hit.name });
  }
  return out;
}

export type SyncResult =
  | { ok: true; mapped: number; products: number; catalog: number }
  | { ok: false; error: string };

/**
 * Pull the POS catalog, auto-match to this store's products by name, and upsert
 * the high-confidence matches. Owner authorization is enforced by the caller.
 */
export async function syncCatalog(provider: PosProviderId, storeId: string): Promise<SyncResult> {
  const adapter = getAdapter(provider);
  if (!adapter?.listCatalog) return { ok: false, error: "This POS can't auto-sync its catalog yet." };
  const creds = await getPosCreds(provider, storeId);
  if (!creds) return { ok: false, error: "Connect this POS first." };

  let catalog: PosCatalogItem[];
  try {
    const { accessToken, creds: fresh } = await getValidAccessToken(provider, storeId);
    catalog = await adapter.listCatalog(accessToken, fresh);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read the POS catalog." };
  }

  const db = createAdminClient();
  const { data: products } = await db
    .from("products")
    .select("sku, name")
    .eq("store_id", storeId)
    .not("sku", "is", null);
  const list = (products ?? []).filter((p): p is { sku: string; name: string } => !!p.sku && !!p.name);

  const matches = autoMatch(list, catalog);
  if (matches.length) {
    const rows = matches.map((m) => ({
      store_id: storeId,
      provider,
      sku: m.sku,
      external_id: m.external_id,
      external_name: m.external_name,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await db.from("pos_item_map").upsert(rows, { onConflict: "store_id,provider,sku" });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, mapped: matches.length, products: list.length, catalog: catalog.length };
}
