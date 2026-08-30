import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { profileFor, homeHrefFor } from "@/lib/console-profile";
import { getWallet, getLedger, getBillingConfig } from "./actions";
import { BillingView } from "@/components/billing/billing-view";

export const metadata: Metadata = { title: "Credits & billing · Ask Rani" };

export default async function BillingPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner && !ctx.isPlatformAdmin) redirect(homeHrefFor(profileFor(store.businessType)));

  const [wallet, ledger, config] = await Promise.all([
    getWallet(store.id),
    getLedger(store.id),
    getBillingConfig(),
  ]);

  return <BillingView storeId={store.id} wallet={wallet} ledger={ledger} config={config} />;
}
