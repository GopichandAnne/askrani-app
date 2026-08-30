import { cookies } from "next/headers";
import { getSessionContext, type StoreAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const ACTIVE_STORE_COOKIE = "ar_store";

/** Opt-in module flags for a store (from agent_config). Used to show/hide the
 *  optional console modules (Catalog, Orders) for capability-driven profiles
 *  like SaaS — a product turns them on only if their operations need them. */
export type StoreCapabilities = { orders: boolean; catalog: boolean };

export async function getStoreCapabilities(storeId: string): Promise<StoreCapabilities> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("agent_config")
      .select("key, value")
      .eq("store_id", storeId)
      .in("key", ["orders_enabled", "catalog_enabled"]);
    const on = (k: string) => (data ?? []).some((r) => r.key === k && r.value === "true");
    return { orders: on("orders_enabled"), catalog: on("catalog_enabled") };
  } catch {
    return { orders: false, catalog: false };
  }
}

export type ActiveStoreContext = {
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  stores: StoreAccess[];
  active: StoreAccess | null;
};

/**
 * Server helper: the signed-in user's accessible stores plus the currently
 * active one (from the `ar_store` cookie, falling back to the first store).
 * Returns null when not authenticated. Pages call this to scope their queries.
 */
export async function getActiveStore(): Promise<ActiveStoreContext | null> {
  const ctx = await getSessionContext();
  if (!ctx) return null;

  const cookieStore = await cookies();
  const wanted = cookieStore.get(ACTIVE_STORE_COOKIE)?.value;
  const active =
    ctx.stores.find((s) => s.slug === wanted) ?? ctx.stores[0] ?? null;

  return { ...ctx, active };
}
