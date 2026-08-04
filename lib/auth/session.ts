import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type StoreRole = Database["public"]["Enums"]["staff_role"];

export type StoreAccess = {
  id: string;
  slug: string;
  name: string;
  role: StoreRole;
  /** Drives the vertical vocabulary layer (lib/vertical-vocab.ts). */
  businessType: string | null;
  /** Platform-admin grant: store can open the embedded Ask Rani Insights product. */
  insightsEnabled: boolean;
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
        .select("id, slug, store_display_name, business_type, insights_enabled")
        .order("store_display_name", { ascending: true }),
      supabase.from("staff").select("store_id, role").eq("user_id", user.id),
    ]);

    const isPlatformAdmin = isAdmin ?? false;

    const roleByStore = new Map<string, StoreRole>();
    for (const row of staffRes.data ?? []) {
      roleByStore.set(row.store_id, row.role);
    }

    // Resilient to migration 0065 not being applied yet: if the select errored
    // (e.g. the insights_enabled column doesn't exist), fall back to the base
    // columns so auth/store resolution never breaks. Insights just stays hidden
    // until the column exists.
    let storeRows: Array<{
      id: string; slug: string; store_display_name: string | null;
      business_type: string | null; insights_enabled?: boolean;
    }> = storesRes.data ?? [];
    if (storesRes.error) {
      const fb = await supabase
        .from("stores")
        .select("id, slug, store_display_name, business_type")
        .order("store_display_name", { ascending: true });
      storeRows = fb.data ?? [];
    }

    const stores: StoreAccess[] = storeRows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.store_display_name ?? s.slug,
      role: roleByStore.get(s.id) ?? (isPlatformAdmin ? "owner" : "staff"),
      businessType: s.business_type ?? null,
      insightsEnabled: s.insights_enabled ?? false,
    }));

    return {
      user: { id: user.id, email: user.email ?? null },
      isPlatformAdmin,
      stores,
    };
  },
);
