"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSessionContext } from "@/lib/auth/session";
import { ACTIVE_STORE_COOKIE } from "@/lib/store/active-store";

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
