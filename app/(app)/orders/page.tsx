import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toOrder } from "@/lib/orders/types";
import type { Charge } from "@/lib/orders/totals";
import { OrdersBoard } from "@/components/orders/orders-board";
import { SetupChecklist } from "@/components/setup/setup-checklist";

export const metadata: Metadata = { title: "Orders · Ask Rani" };

export default async function OrdersPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const admin = createAdminClient();
  const [ordersRes, chargesRes] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("store_slug", store.slug)
      .order("timestamp", { ascending: false, nullsFirst: false })
      .limit(200),
    admin
      .from("store_charges")
      .select("label, kind, value, applies_to, enabled, sort")
      .eq("store_id", store.id)
      .eq("enabled", true)
      .order("sort", { ascending: true }),
  ]);

  const orders = (ordersRes.data ?? []).map(toOrder);
  const charges = (chargesRes.data ?? []) as Charge[];

  return (
    <>
      <SetupChecklist />
      <OrdersBoard
        initialOrders={orders}
        storeSlug={store.slug}
        storeName={store.name}
        charges={charges}
      />
    </>
  );
}
