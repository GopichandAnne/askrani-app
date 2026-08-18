"use server";

import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";

/**
 * Disconnect a connected provider. Runs through the oauth-disconnect edge function
 * (owner-authed), which best-effort REVOKES the grant at the provider and then
 * deletes our stored tokens. We go via the edge runtime because the OAuth app
 * secrets + token-encryption key live there, not in this app. Owner only.
 */
export async function disconnectProvider(provider: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "You're not signed in." };
  if (ctx.active.role !== "owner") return { ok: false, error: "Only the store owner can change connections." };

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("oauth-disconnect", {
    body: { storeSlug: ctx.active.slug, provider },
  });
  const err = error?.message ?? (data as { error?: string } | null)?.error;
  if (err || !(data as { ok?: boolean } | null)?.ok) return { ok: false, error: err ?? "Couldn't disconnect." };
  return { ok: true };
}
