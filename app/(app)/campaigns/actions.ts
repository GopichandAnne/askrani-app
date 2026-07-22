"use server";

import { revalidatePath } from "next/cache";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStore } from "@/lib/store/active-store";

// Owner config for the give-and-get (share & earn) campaign — owner-managed. The
// reward tables are service-role-only (RLS), so writes go through the admin client.

export type GiveGetConfig = {
  active: boolean;
  recipientAmountUsd: number;   // friend gets $X off
  recipientMinOrderUsd: number; // ...on a first order of $Y+
  initiatorAmountUsd: number;   // customer gets $Z credit when the friend orders
  budgetCapUsd: number | null;  // monthly ceiling; null = uncapped (discouraged)
};
export type SaveResult = { ok: true } | { ok: false; error: string };

async function requireOwner(): Promise<{ ok: true; storeId: string } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner && !ctx.isPlatformAdmin) return { ok: false, error: "Only owners can manage campaigns." };
  return { ok: true, storeId: ctx.active.id };
}

/** Load the store's give-and-get config (its campaign + referral rule), or null. */
export async function loadGiveGet(): Promise<GiveGetConfig | null> {
  const gate = await requireOwner();
  if (!gate.ok) return null;
  const admin = createAdminClient();
  const { data: rule } = await admin
    .from("reward_rules")
    .select("amount_cents, recipient_amount_cents, recipient_min_order_cents, reward_campaigns!inner(status, store_id, budget_cap_cents)")
    .eq("trigger", "referral_first_order")
    .eq("reward_campaigns.store_id", gate.storeId)
    .limit(1)
    .maybeSingle();
  if (!rule) return null;
  const r = rule as unknown as {
    amount_cents: number | null;
    recipient_amount_cents: number | null;
    recipient_min_order_cents: number | null;
    reward_campaigns: { status: string; budget_cap_cents: number | null };
  };
  return {
    active: r.reward_campaigns.status === "active",
    recipientAmountUsd: (r.recipient_amount_cents ?? 0) / 100,
    recipientMinOrderUsd: (r.recipient_min_order_cents ?? 0) / 100,
    initiatorAmountUsd: (r.amount_cents ?? 0) / 100,
    budgetCapUsd: r.reward_campaigns.budget_cap_cents != null ? r.reward_campaigns.budget_cap_cents / 100 : null,
  };
}

/** Create or update the store's single give-and-get campaign + rule. */
export async function saveGiveGet(input: GiveGetConfig): Promise<SaveResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const recipCents = Math.max(0, Math.round(input.recipientAmountUsd * 100));
  const minCents = Math.max(0, Math.round(input.recipientMinOrderUsd * 100));
  const initCents = Math.max(0, Math.round(input.initiatorAmountUsd * 100));
  const budgetCents = input.budgetCapUsd != null && Number.isFinite(input.budgetCapUsd)
    ? Math.max(0, Math.round(input.budgetCapUsd * 100))
    : null;
  if (initCents <= 0 && recipCents <= 0) return { ok: false, error: "Set at least one reward amount." };
  if (budgetCents != null && budgetCents < Math.max(initCents, recipCents)) {
    return { ok: false, error: "Monthly budget should cover at least one reward." };
  }

  const admin = createAdminClient();
  const status = input.active ? "active" : "paused";

  const { data: existing } = await admin
    .from("reward_rules")
    .select("id, campaign_id, reward_campaigns!inner(store_id)")
    .eq("trigger", "referral_first_order")
    .eq("reward_campaigns.store_id", gate.storeId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const e = existing as unknown as { id: string; campaign_id: string };
    await admin.from("reward_campaigns").update({ status, budget_cap_cents: budgetCents }).eq("id", e.campaign_id);
    const { error } = await admin.from("reward_rules").update({
      amount_model: "flat",
      amount_cents: initCents,
      min_order_cents: minCents,
      recipient_kind: "store_credit",
      recipient_amount_cents: recipCents,
      recipient_min_order_cents: minCents,
    }).eq("id", e.id);
    if (error) return { ok: false, error: "Couldn't save the reward amounts." };
  } else {
    const { data: camp, error: cErr } = await admin.from("reward_campaigns").insert({
      store_id: gate.storeId,
      name: "Share & Earn",
      preset: "build_regulars",
      status,
      channel_flags: { share_card: true },
      budget_cap_cents: budgetCents,
    }).select("id").single();
    if (cErr || !camp) return { ok: false, error: "Couldn't create the campaign." };
    const { error: rErr } = await admin.from("reward_rules").insert({
      campaign_id: camp.id,
      trigger: "referral_first_order",
      platform: "whatsapp",
      format: "card",
      amount_model: "flat",
      amount_cents: initCents,
      min_order_cents: minCents,
      recipient_kind: "store_credit",
      recipient_amount_cents: recipCents,
      recipient_min_order_cents: minCents,
    });
    if (rErr) return { ok: false, error: "Couldn't save the reward." };
  }

  revalidatePath("/campaigns");
  return { ok: true };
}

// ── Post & Earn (post-for-credit) config ─────────────────────────────────────
export type ReachBand = { minReach: number; maxReach: number; usd: number };
export type PostEarnConfig = {
  active: boolean;
  platform: string; // instagram | youtube | facebook | any
  model: "flat" | "tier";
  flatUsd: number;
  bands: ReachBand[];
  budgetUsd: number | null;
};

const BIG_REACH = 100_000_000;

export async function loadPostEarn(): Promise<PostEarnConfig | null> {
  const gate = await requireOwner();
  if (!gate.ok) return null;
  const admin = createAdminClient();
  const { data: rule } = await admin
    .from("reward_rules")
    .select("platform, amount_model, amount_cents, tiers, reward_campaigns!inner(status, store_id, budget_cap_cents)")
    .eq("trigger", "ugc_post")
    .eq("reward_campaigns.store_id", gate.storeId)
    .limit(1)
    .maybeSingle();
  if (!rule) return null;
  const r = rule as unknown as {
    platform: string | null;
    amount_model: "flat" | "tier";
    amount_cents: number | null;
    tiers: { min_reach?: number; max_reach?: number; amount_cents: number }[] | null;
    reward_campaigns: { status: string; budget_cap_cents: number | null };
  };
  return {
    active: r.reward_campaigns.status === "active",
    platform: r.platform ?? "any",
    model: r.amount_model === "tier" ? "tier" : "flat",
    flatUsd: (r.amount_cents ?? 0) / 100,
    bands: (r.tiers ?? []).map((t) => ({
      minReach: t.min_reach ?? 0,
      maxReach: t.max_reach && t.max_reach < BIG_REACH ? t.max_reach : 0,
      usd: t.amount_cents / 100,
    })),
    budgetUsd: r.reward_campaigns.budget_cap_cents != null ? r.reward_campaigns.budget_cap_cents / 100 : null,
  };
}

export async function savePostEarn(input: PostEarnConfig): Promise<SaveResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const budgetCents = input.budgetUsd != null && Number.isFinite(input.budgetUsd)
    ? Math.max(0, Math.round(input.budgetUsd * 100)) : null;
  const platform = input.platform === "any" ? null : input.platform;

  let amountCents: number | null = null;
  let tiers: { min_reach: number; max_reach: number; amount_cents: number }[] | null = null;
  if (input.model === "flat") {
    amountCents = Math.max(0, Math.round(input.flatUsd * 100));
    if (amountCents <= 0) return { ok: false, error: "Set a credit amount per post." };
  } else {
    tiers = input.bands
      .filter((b) => b.usd > 0)
      .map((b) => ({
        min_reach: Math.max(0, Math.round(b.minReach)),
        max_reach: b.maxReach > 0 ? Math.round(b.maxReach) : BIG_REACH,
        amount_cents: Math.round(b.usd * 100),
      }))
      .sort((a, b) => a.min_reach - b.min_reach);
    if (!tiers.length) return { ok: false, error: "Add at least one reach band with an amount." };
  }
  const ruleFields = {
    trigger: "ugc_post" as const,
    platform,
    amount_model: input.model,
    min_order_cents: 0,
    amount_cents: amountCents,
    tiers: tiers as unknown as Json,
  };

  const admin = createAdminClient();
  const status = input.active ? "active" : "paused";

  const { data: existing } = await admin
    .from("reward_rules")
    .select("id, campaign_id, reward_campaigns!inner(store_id)")
    .eq("trigger", "ugc_post")
    .eq("reward_campaigns.store_id", gate.storeId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const e = existing as unknown as { id: string; campaign_id: string };
    await admin.from("reward_campaigns").update({ status, budget_cap_cents: budgetCents }).eq("id", e.campaign_id);
    const { error } = await admin.from("reward_rules").update(ruleFields).eq("id", e.id);
    if (error) return { ok: false, error: "Couldn't save the offer." };
  } else {
    const { data: camp, error: cErr } = await admin.from("reward_campaigns").insert({
      store_id: gate.storeId, name: "Post & Earn", preset: "launch_buzz", status,
      channel_flags: { post_for_credit: true }, budget_cap_cents: budgetCents,
    }).select("id").single();
    if (cErr || !camp) return { ok: false, error: "Couldn't create the campaign." };
    const { error: rErr } = await admin.from("reward_rules").insert({ campaign_id: camp.id, ...ruleFields });
    if (rErr) return { ok: false, error: "Couldn't save the offer." };
  }

  revalidatePath("/campaigns");
  return { ok: true };
}
