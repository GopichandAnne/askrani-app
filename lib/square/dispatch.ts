import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { squareConfig } from "./config";
import { getSquareCreds } from "./credentials";
import { pushOrderToSquare } from "./orders";

/**
 * Best-effort push of an approved order to the store's connected Square location.
 * Never throws — approval must succeed even if Square is down. Idempotent: skips
 * if the order already carries a Square id, and Square dedupes on order_id too.
 * A no-op if Square isn't configured on the server or connected for the store.
 */
export async function dispatchApprovedOrderToSquare(orderId: string): Promise<void> {
  try {
    if (!squareConfig().configured) return;
    const db = createAdminClient();
    const { data: o } = await db
      .from("orders")
      .select("order_id, store_slug, currency, items_json, table_label, customer_name, pos_order_id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (!o || o.pos_order_id) return; // not found or already sent

    const { data: store } = await db.from("stores").select("id").eq("slug", o.store_slug).maybeSingle();
    if (!store) return;

    const creds = await getSquareCreds(store.id);
    if (!creds) return; // store hasn't connected Square

    const result = await pushOrderToSquare(store.id, {
      order_id: o.order_id,
      currency: o.currency,
      items_json: o.items_json,
      table_label: o.table_label,
      customer_name: o.customer_name,
    });

    if (result.ok) {
      await db
        .from("orders")
        .update({
          pos_provider: "square",
          pos_order_id: result.squareOrderId,
          pos_synced_at: new Date().toISOString(),
          pos_error: null,
        })
        .eq("order_id", orderId);
    } else {
      await db.from("orders").update({ pos_error: result.error }).eq("order_id", orderId);
    }
  } catch (e) {
    // Swallow — approval already committed; the panel shows a retry on pos_error.
    console.error("[square] dispatch failed:", e instanceof Error ? e.message : e);
  }
}
