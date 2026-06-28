import type { Database } from "@/lib/database.types";

export type Product = Database["public"]["Tables"]["products"]["Row"];

/** Fields the add-product form / inline edits may set. */
export type ProductInput = {
  name: string;
  sku?: string | null;
  brand?: string | null;
  size?: string | null;
  unit?: string | null;
  price?: number | null;
  category?: string | null;
};

/** Inline-editable fields (price + flags + identity bits). */
export type ProductPatch = Partial<
  Pick<
    Product,
    | "name"
    | "sku"
    | "brand"
    | "size"
    | "unit"
    | "price"
    | "in_stock"
    | "verified"
    | "category"
  >
>;
