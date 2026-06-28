import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";

/** Resolve the store for an inbound message by its WhatsApp phone_number_id. */
export async function getStoreByPhoneNumberId(
  db: SupabaseClient,
  phoneNumberId: string,
): Promise<Store | null> {
  const { data } = await db
    .from("stores")
    .select("id, slug, store_display_name")
    .eq("whatsapp_phone_number_id", phoneNumberId)
    .eq("active", true)
    .maybeSingle();
  return (data as Store) ?? null;
}

/** The store's WhatsApp access token (service-role only — never client-readable). */
export async function getStoreAccessToken(
  db: SupabaseClient,
  storeId: string,
): Promise<string | null> {
  const { data } = await db
    .from("store_secrets")
    .select("whatsapp_access_token")
    .eq("store_id", storeId)
    .maybeSingle();
  return data?.whatsapp_access_token ?? null;
}
