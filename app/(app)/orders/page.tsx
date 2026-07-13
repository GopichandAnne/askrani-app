import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { toOrder } from "@/lib/orders/types";
import { OrdersBoard } from "@/components/orders/orders-board";
import { SetupChecklist } from "@/components/setup/setup-checklist";

export const metadata: Metadata = { title: "Orders · Ask Rani" };

export default async function OrdersPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const [ordersRes, cfgRes] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("store_slug", store.slug)
      .order("timestamp", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from("agent_config")
      .select("value")
      .eq("store_id", store.id)
      .eq("key", "tax_rate")
      .maybeSingle(),
  ]);

  const orders = (ordersRes.data ?? []).map(toOrder);
  const taxRate = Number.parseFloat(cfgRes.data?.value ?? "0") || 0;

  return (
    <>
      <SetupChecklist />
      <OrdersBoard
        initialOrders={orders}
        storeSlug={store.slug}
        storeName={store.name}
        taxRate={taxRate}
      />
    </>
  );
}
