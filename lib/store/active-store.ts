import { cookies } from "next/headers";
import { getSessionContext, type StoreAccess } from "@/lib/auth/session";

export const ACTIVE_STORE_COOKIE = "ar_store";

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
