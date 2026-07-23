import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { CampaignsClient } from "./campaigns-client";
import { PostEarnClient } from "./post-earn-client";
import { loadGiveGet, loadPostEarn, loadResults, type CampaignResults, type GiveGetConfig, type PostEarnConfig } from "./actions";
import { POST_PLATFORMS, PLATFORM_FORMATS } from "./post-earn-shared";

export const metadata: Metadata = { title: "Campaigns · Ask Rani" };

const DEFAULTS: GiveGetConfig = {
  active: false,
  recipientAmountUsd: 5,
  recipientMinOrderUsd: 30,
  initiatorAmountUsd: 5,
  budgetCapUsd: 200,
};

const POST_DEFAULTS: PostEarnConfig = {
  active: false,
  platforms: POST_PLATFORMS.map((p) => ({
    platform: p,
    enabled: p === "instagram", // Instagram on by default; others opt-in
    model: "flat",
    flatUsd: 5,
    baseUsd: 0,
    bands: [],
    formatUsd: Object.fromEntries((PLATFORM_FORMATS[p] ?? []).map((k) => [k, 0])),
  })),
  promoContext: "",
  shareMedia: [],
  budgetUsd: 200,
};

export default async function CampaignsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner && !ctx.isPlatformAdmin) redirect("/orders");

  const [initial, postInitial, results] = await Promise.all([loadGiveGet(), loadPostEarn(), loadResults()]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Campaigns</h1>
        <p className="text-muted-foreground text-sm">
          {store.name} — reward customers for bringing you business. Share &amp; Earn pays when a friend orders;
          Post &amp; Earn pays when they post about you on social media (you review each post).
        </p>
      </header>
      {results && <ResultsCard r={results} />}
      <CampaignsClient initial={initial ?? DEFAULTS} />
      <PostEarnClient initial={postInitial ?? POST_DEFAULTS} />
    </div>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

function ResultsCard({ r }: { r: CampaignResults }) {
  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: "Credit earned", value: usd(r.earnedUsd), hint: "all time" },
    { label: "Outstanding", value: usd(r.outstandingUsd), hint: "credit you owe" },
    { label: "Redeemed", value: usd(r.redeemedUsd), hint: "used in store" },
    { label: "Referral orders", value: String(r.referralOrders) },
    { label: "Posts approved", value: String(r.postsApproved) },
    { label: "Posts to review", value: String(r.postsPending) },
  ];
  return (
    <div className="rounded-xl border p-4">
      <h2 className="mb-3 text-sm font-medium">Results</h2>
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border p-3">
            <div className="text-lg font-semibold tabular-nums">{t.value}</div>
            <div className="text-muted-foreground text-xs">{t.label}</div>
            {t.hint && <div className="text-muted-foreground/70 text-[10px]">{t.hint}</div>}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        <span className="font-medium">Outstanding</span> is credit customers can still spend — a real liability. It converts
        to a discount at your cost only when they come back and buy.
      </p>
    </div>
  );
}
