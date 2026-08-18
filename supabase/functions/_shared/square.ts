// Square helpers for the bot's catalog/order tools. Takes a live access token
// (from the OAuth broker vault) and speaks the Square Connect v2 API. Read-only:
// look up an item's price + stock, and an order's status.

const SQ_BASE = "https://connect.squareup.com/v2";
const SQ_VER = "2023-10-18"; // a long-supported Square API version

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json", "Square-Version": SQ_VER, accept: "application/json" };
}

export interface SqItem { name: string; price: string | null; currency: string | null; in_stock: number | null }

/** Search the catalog by text; return top items with price + (best-effort) stock. */
export async function findItems(token: string, query: string): Promise<SqItem[]> {
  const res = await fetch(`${SQ_BASE}/catalog/search-catalog-items`, {
    method: "POST", headers: headers(token), body: JSON.stringify({ text_filter: query, limit: 5 }),
  });
  if (!res.ok) throw new Error(`square catalog ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const j: any = await res.json();
  const items = (j.items ?? []) as any[]; // deno-lint-ignore no-explicit-any

  const rows: { name: string; price: string | null; currency: string | null; variationId: string | null }[] = [];
  const varIds: string[] = [];
  for (const it of items) {
    const name = it.item_data?.name ?? "item";
    const v = it.item_data?.variations?.[0];
    const pm = v?.item_variation_data?.price_money;
    const price = pm?.amount != null ? (Number(pm.amount) / 100).toFixed(2) : null;
    const vid = v?.id ?? null;
    if (vid) varIds.push(vid);
    rows.push({ name, price, currency: pm?.currency ?? null, variationId: vid });
  }

  const stock = new Map<string, number>();
  if (varIds.length) {
    try {
      const inv = await fetch(`${SQ_BASE}/inventory/counts/batch-retrieve`, {
        method: "POST", headers: headers(token), body: JSON.stringify({ catalog_object_ids: varIds, states: ["IN_STOCK"] }),
      });
      if (inv.ok) {
        // deno-lint-ignore no-explicit-any
        const jj: any = await inv.json();
        for (const c of (jj.counts ?? [])) stock.set(c.catalog_object_id, Number(c.quantity ?? 0));
      }
    } catch { /* inventory optional */ }
  }
  return rows.map((r) => ({ name: r.name, price: r.price, currency: r.currency, in_stock: r.variationId ? (stock.get(r.variationId) ?? null) : null }));
}

/** Retrieve one order's state + total + fulfillment status. */
export async function orderStatus(token: string, orderId: string): Promise<{ state: string; total: string | null; currency: string | null; fulfillment: string | null } | null> {
  const res = await fetch(`${SQ_BASE}/orders/batch-retrieve`, {
    method: "POST", headers: headers(token), body: JSON.stringify({ order_ids: [orderId] }),
  });
  if (!res.ok) return null;
  // deno-lint-ignore no-explicit-any
  const j: any = await res.json();
  const o = (j.orders ?? [])[0];
  if (!o) return null;
  const tm = o.total_money;
  return {
    state: o.state ?? "UNKNOWN",
    total: tm?.amount != null ? (Number(tm.amount) / 100).toFixed(2) : null,
    currency: tm?.currency ?? null,
    fulfillment: o.fulfillments?.[0]?.state ?? null,
  };
}
