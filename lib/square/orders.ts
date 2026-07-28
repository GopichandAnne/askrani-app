import "server-only";
import { squareConfig, SQUARE_VERSION } from "./config";
import { getValidAccessToken } from "./credentials";

/** One line as stored in orders.items_json (priced catalog line). */
type OrderItem = {
  name?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null; // dollars
  notes?: string | null;
  catalog_matched?: boolean;
  mod_sel?: { group: string; option: string }[] | null;
};

export type OrderForPush = {
  order_id: string;
  currency: string | null;
  items_json: unknown;
  table_label: string | null;
  customer_name: string | null;
};

export type PushResult = { ok: true; squareOrderId: string } | { ok: false; error: string };

/** Build Square ad-hoc line items from our stored order items. Only priced lines
 *  go to Square as-is; each carries its notes + chosen modifiers as a line note. */
function toLineItems(items: OrderItem[], currency: string) {
  const out: Record<string, unknown>[] = [];
  for (const it of items) {
    const cents = it.unit_price == null ? null : Math.round(Number(it.unit_price) * 100);
    if (cents == null || !Number.isFinite(cents)) continue; // skip unpriced/request lines
    const mods = (it.mod_sel ?? []).map((m) => `${m.group}: ${m.option}`).join(", ");
    const note = [mods, it.notes].filter(Boolean).join(" · ").slice(0, 500);
    out.push({
      name: (it.name ?? it.description ?? "Item").slice(0, 500),
      quantity: String(Math.max(1, Math.round(Number(it.quantity ?? 1)))),
      base_price_money: { amount: cents, currency },
      ...(note ? { note } : {}),
    });
  }
  return out;
}

/**
 * Push an approved order to the store's connected Square location as an open
 * order. Idempotent on our order_id (Square dedupes on idempotency_key), so a
 * retry never creates a second ticket. Returns the Square order id on success.
 */
export async function pushOrderToSquare(storeId: string, order: OrderForPush): Promise<PushResult> {
  const cfg = squareConfig();
  if (!cfg.configured) return { ok: false, error: "Square is not configured on this server." };

  let accessToken: string;
  let locationId: string | null;
  try {
    const v = await getValidAccessToken(storeId);
    accessToken = v.accessToken;
    locationId = v.creds.location_id;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Square not connected." };
  }
  if (!locationId) return { ok: false, error: "No Square location selected for this store." };

  const currency = (order.currency ?? "USD").toUpperCase();
  const items = Array.isArray(order.items_json) ? (order.items_json as OrderItem[]) : [];
  const lineItems = toLineItems(items, currency);
  if (!lineItems.length) return { ok: false, error: "No priced items to send to Square." };

  const ticketName = (order.table_label || order.customer_name || order.order_id).slice(0, 30);
  const body = {
    idempotency_key: order.order_id.slice(0, 192),
    order: {
      location_id: locationId,
      reference_id: order.order_id.slice(0, 40),
      ticket_name: ticketName,
      source: { name: "Ask Rani" },
      line_items: lineItems,
    },
  };

  const res = await fetch(`${cfg.apiBase}/v2/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    order?: { id?: string };
    errors?: { detail?: string }[];
  };
  if (!res.ok || !json.order?.id) {
    const detail = json.errors?.[0]?.detail ?? `HTTP ${res.status}`;
    return { ok: false, error: `Square rejected the order: ${detail}` };
  }
  return { ok: true, squareOrderId: json.order.id };
}
