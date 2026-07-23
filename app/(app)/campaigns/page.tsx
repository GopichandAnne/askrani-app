import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { CampaignsClient } from "./campaigns-client";
import { PostEarnClient } from "./post-earn-client";
import { loadGiveGet, loadPostEarn, type GiveGetConfig, type PostEarnConfig } from "./actions";
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

  const [initial, postInitial] = await Promise.all([loadGiveGet(), loadPostEarn()]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Campaigns</h1>
        <p className="text-muted-foreground text-sm">
          {store.name} — reward customers for bringing you business. Share &amp; Earn pays when a friend orders;
          Post &amp; Earn pays when they post about you on social media (you review each post).
        </p>
      </header>
      <CampaignsClient initial={initial ?? DEFAULTS} />
      <PostEarnClient initial={postInitial ?? POST_DEFAULTS} />
    </div>
  );
}
