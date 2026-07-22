import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { CampaignsClient } from "./campaigns-client";
import { loadGiveGet, type GiveGetConfig } from "./actions";

export const metadata: Metadata = { title: "Campaigns · Ask Rani" };

const DEFAULTS: GiveGetConfig = {
  active: false,
  recipientAmountUsd: 5,
  recipientMinOrderUsd: 30,
  initiatorAmountUsd: 5,
  budgetCapUsd: 200,
};

export default async function CampaignsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner && !ctx.isPlatformAdmin) redirect("/orders");

  const initial = (await loadGiveGet()) ?? DEFAULTS;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Campaigns</h1>
        <p className="text-muted-foreground text-sm">
          {store.name} — turn on a share &amp; earn offer. Customers get a card to forward; credit is earned when
          a friend orders and redeemed at your counter.
        </p>
      </header>
      <CampaignsClient initial={initial} />
    </div>
  );
}
