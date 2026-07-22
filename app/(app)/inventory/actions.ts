"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";
import type { Product, ProductInput, ProductPatch } from "@/lib/inventory/types";

export type ProductResult =
  | { ok: true; product: Product }
  | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

const PRODUCT_COLUMNS =
  "id, store_id, sku, name, brand, size, unit, price, currency, in_stock, verified, category, image_url, created_by, created_at, updated_at";

function cleanStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s === "" ? null : s;
}

function cleanPrice(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Inline edit: price / flags / identity bits. RLS scopes to the user's stores. */
export async function updateProduct(
  id: string,
  patch: ProductPatch,
): Promise<ProductResult> {
  const supabase = await createClient();

  const next: ProductPatch = {};
  if ("name" in patch) {
    const n = cleanStr(patch.name);
    if (!n) return { ok: false, error: "Name can't be empty." };
    next.name = n;
  }
  if ("sku" in patch) next.sku = cleanStr(patch.sku);
  if ("brand" in patch) next.brand = cleanStr(patch.brand);
  if ("size" in patch) next.size = cleanStr(patch.size);
  if ("unit" in patch) next.unit = cleanStr(patch.unit);
  if ("category" in patch) next.category = cleanStr(patch.category);
  if ("image_url" in patch) next.image_url = cleanStr(patch.image_url);
  if ("price" in patch) next.price = cleanPrice(patch.price);
  if ("in_stock" in patch) next.in_stock = !!patch.in_stock;
  if ("verified" in patch) next.verified = !!patch.verified;

  // Price is a catalog/money change -> owners only (in_stock/verified are not).
  // Enforced server-side here AND by the DB trigger (0010) for the raw-API path.
  if ("price" in next) {
    const { data: prod } = await supabase
      .from("products")
      .select("store_id")
      .eq("id", id)
      .maybeSingle();
    if (!prod) return { ok: false, error: "Product not found." };
    const { data: ownerFlag } = await supabase.rpc("user_is_owner", {
      p_store_id: prod.store_id,
    });
    if (!ownerFlag) {
      return { ok: false, error: "Only owners can change product prices." };
    }
  }

  const { data, error } = await supabase
    .from("products")
    .update(next)
    .eq("id", id)
    .select(PRODUCT_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Product not found." };

  revalidatePath("/inventory");
  return { ok: true, product: data as Product };
}

/** Add a product to the active store. */
export async function addProduct(input: ProductInput): Promise<ProductResult> {
  const name = cleanStr(input.name);
  if (!name) return { ok: false, error: "Name is required." };

  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Adding a product is a catalog action -> owners only (also enforced by RLS).
  const { data: ownerFlag } = await supabase.rpc("user_is_owner", {
    p_store_id: ctx.active.id,
  });
  if (!ownerFlag) {
    return { ok: false, error: "Only owners can add products." };
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      store_id: ctx.active.id,
      name,
      sku: cleanStr(input.sku),
      brand: cleanStr(input.brand),
      size: cleanStr(input.size),
      unit: cleanStr(input.unit),
      price: cleanPrice(input.price),
      category: cleanStr(input.category),
      image_url: cleanStr(input.image_url),
      created_by: user?.id ?? null,
    })
    .select(PRODUCT_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/inventory");
  return { ok: true, product: data as Product };
}

/** Upload a product image to the public branding bucket; returns its URL.
 *  Owners only. The panel then saves the URL onto products.image_url. */
export async function uploadProductImage(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: ownerFlag } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!ownerFlag) return { ok: false, error: "Only owners can change product images." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded." };
  if (!file.type.startsWith("image/")) return { ok: false, error: "Please upload an image file." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Image must be under 5 MB." };

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `products/${ctx.active.slug}/${crypto.randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await admin.storage.from("branding").upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };
  const { data } = admin.storage.from("branding").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

// ── Intelligent catalogue import (URL / file / text → extract → preview → add) ──
export type ExtractedProduct = {
  name: string;
  category?: string | null;
  price?: number | null;
  description?: string | null;
  sku?: string | null;
  image_url?: string | null;
};

async function requireOwnerSlug(): Promise<
  { ok: true; slug: string } | { ok: false; error: string }
> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can import a catalogue." };
  return { ok: true, slug: ctx.active.slug };
}

export type ApiImportSource = {
  url: string;
  headers?: Record<string, string>;
  list_path?: string;
  map?: Partial<Record<"name" | "price" | "sku" | "category" | "description" | "image_url", string>>;
  paginate?: { next_path?: string; page_param?: string; start?: number; max_pages?: number };
};

export async function extractCatalogue(input: {
  url?: string;
  text?: string;
  file?: { mime: string; base64: string };
  api?: ApiImportSource;
}): Promise<{ ok: true; products: ExtractedProduct[] } | { ok: false; error: string }> {
  const gate = await requireOwnerSlug();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({ action: "extract_catalogue", store_slug: gate.slug, ...input });
  if (!res.ok) return res;
  return { ok: true, products: (res.data.products as ExtractedProduct[]) ?? [] };
}

export async function importProducts(
  products: ExtractedProduct[],
  mode: "append" | "replace",
): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  const gate = await requireOwnerSlug();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({ action: "import_products", store_slug: gate.slug, products, mode });
  if (!res.ok) return res;
  revalidatePath("/inventory");
  return { ok: true, imported: (res.data.imported as number) ?? 0 };
}

/** Remove a product. Owners only (also enforced by RLS). */
export async function removeProduct(id: string): Promise<SimpleResult> {
  const supabase = await createClient();

  const { data: prod } = await supabase
    .from("products")
    .select("store_id")
    .eq("id", id)
    .maybeSingle();
  if (!prod) return { ok: false, error: "Product not found." };
  const { data: ownerFlag } = await supabase.rpc("user_is_owner", {
    p_store_id: prod.store_id,
  });
  if (!ownerFlag) {
    return { ok: false, error: "Only owners can remove products." };
  }

  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  return { ok: true };
}
