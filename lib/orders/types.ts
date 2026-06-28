import type { Database } from "@/lib/database.types";

export type OrderStatus = Database["public"]["Enums"]["order_status"];
export type OrderMode = Database["public"]["Enums"]["order_mode"];
export type FulfillmentType = Database["public"]["Enums"]["fulfillment_type"];

export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

/** Catalog-matched line item (real shape from Cart.gs / editOrder). */
export type CatalogItem = {
  sku: string;
  catalog_matched: true;
  name: string;
  brand?: string | null;
  size?: string | null;
  unit?: string | null;
  quantity: number;
  notes?: string | null;
  unit_price: number;
  line_total: number;
};

/** Off-catalog "request" line item — owner sets the price (unit_price/line_total
 *  start null until priced). */
export type RequestItem = {
  sku: "";
  item_id: string;
  catalog_matched: false;
  description?: string | null;
  name?: string | null;
  brand?: string | null;
  size?: string | null;
  unit?: string | null;
  quantity: number;
  notes?: string | null;
  unit_price: number | null;
  line_total: number | null;
};

export type OrderItem = CatalogItem | RequestItem;

export function isRequestItem(item: OrderItem): item is RequestItem {
  return item.catalog_matched === false;
}

/** An order with `items_json` parsed into the typed union. */
export type Order = Omit<OrderRow, "items_json"> & { items_json: OrderItem[] };

/** Coerce the raw jsonb (from a query or a realtime payload) into typed items. */
export function parseItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw as OrderItem[];
}

/** Normalize a raw order row (jsonb items) into a typed Order. */
export function toOrder(row: OrderRow): Order {
  return { ...row, items_json: parseItems(row.items_json) };
}
