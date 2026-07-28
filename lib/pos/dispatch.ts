import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredAdapters } from "./registry";
import { getPosCreds, getValidAccessToken } from "./credentials";
import { getItemMap } from "./mapping";

/**
 * Best-effort push of an approved order to whichever POS the store connected.
 * Never throws — approval must succeed even if the POS is down. Idempotent: skips
 * if the order already carries an external id. No-op if no POS is configured or
 * connected. A store normally connects one POS; if several, pushes to each and
 * records the first success.
 */
export async function dispatchApprovedOrder(orderId: string): Promise<void> {
  try {
    const adapters = configuredAdapters();
    if (!adapters.length) return;

    const db = createAdminClient();
    const { data: o } = await db
      .from("orders")
      .select("order_id, store_slug, currency, items_json, table_label, customer_name, pos_order_id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (!o || o.pos_order_id) return;

    const { data: store } = await db.from("stores").select("id").eq("slug", o.store_slug).maybeSingle();
    if (!store) return;

    const order = {
      order_id: o.order_id,
      currency: o.currency,
      items_json: o.items_json,
      table_label: o.table_label,
      customer_name: o.customer_name,
    };

    let success: { provider: string; externalId: string } | null = null;
    const errors: string[] = [];

    for (const adapter of adapters) {
      const creds = await getPosCreds(adapter.id, store.id);
      if (!creds) continue; // store didn't connect this POS
      try {
        const { accessToken, creds: fresh } = await getValidAccessToken(adapter.id, store.id);
        const itemMap = await getItemMap(adapter.id, store.id);
        const result = await adapter.pushOrder(accessToken, fresh, order, itemMap);
        if (result.ok) {
          if (!success) success = { provider: adapter.id, externalId: result.externalOrderId };
        } else {
          errors.push(`${adapter.label}: ${result.error}`);
        }
      } catch (e) {
        errors.push(`${adapter.label}: ${e instanceof Error ? e.message : "push failed"}`);
      }
    }

    if (success) {
      await db
        .from("orders")
        .update({
          pos_provider: success.provider,
          pos_order_id: success.externalId,
          pos_synced_at: new Date().toISOString(),
          pos_error: null,
        })
        .eq("order_id", orderId);
    } else if (errors.length) {
      await db.from("orders").update({ pos_error: errors.join(" · ") }).eq("order_id", orderId);
    }
  } catch (e) {
    console.error("[pos] dispatch failed:", e instanceof Error ? e.message : e);
  }
}
