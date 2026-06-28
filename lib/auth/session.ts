import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type StoreRole = Database["public"]["Enums"]["staff_role"];

export type StoreAccess = {
  id: string;
  slug: string;
  name: string;
  role: StoreRole;
};

export type SessionContext = {
  user: { id: string; email: string | null };
  isPlatformAdmin: boolean;
  stores: StoreAccess[];
};

/**
 * Resolves the signed-in user and the stores they may access, with their role
 * per store. Returns null when not authenticated.
 *
 * Reads are RLS-scoped: `stores` returns only accessible rows, `staff` returns
 * the user's own rows. Platform-admin status comes from the SECURITY DEFINER
 * `is_platform_admin()` RPC (the platform_admins table itself is not client
 * readable). A platform admin sees every store and is treated as owner.
 *
 * Wrapped in React `cache` so the layout + page in one request share a single
 * round-trip.
 */
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const [{ data: isAdmin }, storesRes, staffRes] = await Promise.all([
      supabase.rpc("is_platform_admin"),
      supabase
        .from("stores")
        .select("id, slug, store_display_name")
        .order("store_display_name", { ascending: true }),
      supabase.from("staff").select("store_id, role").eq("user_id", user.id),
    ]);

    const isPlatformAdmin = isAdmin ?? false;

    const roleByStore = new Map<string, StoreRole>();
    for (const row of staffRes.data ?? []) {
      roleByStore.set(row.store_id, row.role);
    }

    const stores: StoreAccess[] = (storesRes.data ?? []).map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.store_display_name ?? s.slug,
      role: roleByStore.get(s.id) ?? (isPlatformAdmin ? "owner" : "staff"),
    }));

    return {
      user: { id: user.id, email: user.email ?? null },
      isPlatformAdmin,
      stores,
    };
  },
);
