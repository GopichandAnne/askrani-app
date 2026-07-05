import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const GRAPH = "v21.0";

/**
 * Send a plain-text WhatsApp message from a store to a customer. Server-only:
 * reads the store's phone_number_id + access token (store_secrets) with the
 * admin client. Best-effort — returns {ok:false, error} rather than throwing.
 */
export async function sendWhatsAppText(
  storeSlug: string,
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: store } = await admin
    .from("stores")
    .select("id, whatsapp_phone_number_id")
    .eq("slug", storeSlug)
    .maybeSingle();
  if (!store?.whatsapp_phone_number_id) {
    return { ok: false, error: "store has no WhatsApp phone number configured" };
  }
  const { data: sec } = await admin
    .from("store_secrets")
    .select("whatsapp_access_token")
    .eq("store_id", store.id)
    .maybeSingle();
  if (!sec?.whatsapp_access_token) {
    return { ok: false, error: "store has no WhatsApp access token" };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH}/${store.whatsapp_phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sec.whatsapp_access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body },
        }),
      },
    );
    if (!res.ok) return { ok: false, error: `WhatsApp send failed (HTTP ${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
