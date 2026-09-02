import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// The product-tour store — the "Ask Rani - Assistant" store whose embed runs on
// agent.askrani.ai. Its publishable key is public (it ships in the embed snippet);
// override via env if it ever changes.
export const TOUR_STORE_KEY = process.env.TOUR_STORE_KEY || "pk_live_bcc9d886cbe042748f67eb3854aa025a";
const TOUR_KEY = TOUR_STORE_KEY;

export type TourStore = {
  id: string;
  name: string;
  identitySecret: string | null;
  accessControl: boolean;
};

/** Resolve the tour store (id + its SSO identity secret) from the publishable key. */
export async function getTourStore(): Promise<TourStore | null> {
  const db = createAdminClient();
  const { data: tok } = await db
    .from("store_tokens")
    .select("store_id")
    .eq("token", TOUR_KEY)
    .eq("active", true)
    .maybeSingle();
  const storeId = (tok as { store_id?: string } | null)?.store_id;
  if (!storeId) return null;
  const { data: s } = await db
    .from("stores")
    .select("id, store_display_name, slug, identity_secret, access_control")
    .eq("id", storeId)
    .maybeSingle();
  if (!s) return null;
  const row = s as {
    id: string; store_display_name: string | null; slug: string;
    identity_secret: string | null; access_control: string | boolean | null;
  };
  return {
    id: row.id,
    name: row.store_display_name ?? row.slug,
    identitySecret: row.identity_secret,
    // access_control is stored as text ('on'/'off') or bool depending on migration.
    accessControl: row.access_control === true || row.access_control === "on" || row.access_control === "true",
  };
}
