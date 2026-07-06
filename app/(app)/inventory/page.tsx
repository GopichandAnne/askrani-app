import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import type { Product } from "@/lib/inventory/types";
import { InventoryTable } from "@/components/inventory/inventory-table";

export const metadata: Metadata = { title: "Catalog · Ask Rani" };

export default async function InventoryPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("store_id", store.id)
    .order("name", { ascending: true })
    .limit(1000);

  return (
    <InventoryTable
      key={store.slug}
      initialProducts={(products ?? []) as Product[]}
      storeName={store.name}
    />
  );
}
