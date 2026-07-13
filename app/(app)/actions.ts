"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSessionContext } from "@/lib/auth/session";
import { ACTIVE_STORE_COOKIE, getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Counts for "needs attention" nav badges (open questions/tickets, new requests)
 * for the active store. Keyed by nav href. Called from the sidebar; refreshed on
 * navigation so answering something updates the badge.
 */
export async function getNavCounts(): Promise<Record<string, number>> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return {};
  const store = ctx.active;
  const supabase = await createClient();
  const out: Record<string, number> = {};

  const { count: openTickets } = await supabase
    .from("tickets")
    .select("ticket_id", { count: "exact", head: true })
    .eq("store_slug", store.slug)
    .in("status", ["created", "sent_to_owner"]);
  out["/tickets"] = openTickets ?? 0;

  // requests is service-role only (RLS) — read via admin, owners only.
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (isOwner) {
    const admin = createAdminClient();
    const { count: newRequests } = await admin
      .from("requests")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id)
      .eq("status", "new");
    out["/requests"] = newRequests ?? 0;
  }
  return out;
}

/**
 * Set the active store. Validates the slug against the user's accessible stores
 * (never trust the client) before writing the cookie, then revalidates the
 * shell so server components re-read the new scope.
 */
export async function setActiveStore(slug: string): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx) return;
  if (!ctx.stores.some((s) => s.slug === slug)) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_STORE_COOKIE, slug, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
