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
export type FormatAmounts = { reel: number; post: number; story: number };
export type ShareMediaItem = { url: string; label?: string | null };
export type PostEarnConfig = {
  active: boolean;
  platform: string; // instagram | youtube | facebook | any
  model: "flat" | "tier" | "format";
  flatUsd: number;
  baseUsd: number;              // guaranteed base per post that stacks under a reach/format bonus
  bands: ReachBand[];
  formatUsd: FormatAmounts;      // per-format credit (reel/post/story), in dollars
  shareMedia: ShareMediaItem[];  // owner-uploaded images Rani hands out to post
  budgetUsd: number | null;
};

const BIG_REACH = 100_000_000;
const emptyFormats = (): FormatAmounts => ({ reel: 0, post: 0, story: 0 });

function cleanMedia(items: ShareMediaItem[]): ShareMediaItem[] {
  return (items ?? [])
    .filter((m) => m && typeof m.url === "string" && /^https:\/\/\S+$/.test(m.url))
    .slice(0, 8)
    .map((m) => ({ url: m.url, label: m.label?.trim() || null }));
}

export async function loadPostEarn(): Promise<PostEarnConfig | null> {
  const gate = await requireOwner();
  if (!gate.ok) return null;
  const admin = createAdminClient();
  const { data: rule } = await admin
    .from("reward_rules")
    .select("platform, amount_model, amount_cents, tiers, format_amounts, reward_campaigns!inner(status, store_id, budget_cap_cents, share_media)")
    .eq("trigger", "ugc_post")
    .eq("reward_campaigns.store_id", gate.storeId)
    .limit(1)
    .maybeSingle();
  if (!rule) return null;
  const r = rule as unknown as {
    platform: string | null;
    amount_model: "flat" | "tier" | "format";
    amount_cents: number | null;
    tiers: { min_reach?: number; max_reach?: number; amount_cents: number }[] | null;
    format_amounts: Record<string, number> | null;
    reward_campaigns: { status: string; budget_cap_cents: number | null; share_media: ShareMediaItem[] | null };
  };
  const fa = r.format_amounts ?? {};
  return {
    active: r.reward_campaigns.status === "active",
    platform: r.platform ?? "any",
    model: r.amount_model === "tier" ? "tier" : r.amount_model === "format" ? "format" : "flat",
    flatUsd: (r.amount_cents ?? 0) / 100,
    // For tier/format, amount_cents is the guaranteed base; for flat it IS the amount.
    baseUsd: r.amount_model === "flat" ? 0 : (r.amount_cents ?? 0) / 100,
    bands: (r.tiers ?? []).map((t) => ({
      minReach: t.min_reach ?? 0,
      maxReach: t.max_reach && t.max_reach < BIG_REACH ? t.max_reach : 0,
      usd: t.amount_cents / 100,
    })),
    formatUsd: { reel: (fa.reel ?? 0) / 100, post: (fa.post ?? 0) / 100, story: (fa.story ?? 0) / 100 },
    shareMedia: cleanMedia((r.reward_campaigns.share_media ?? []) as ShareMediaItem[]),
    budgetUsd: r.reward_campaigns.budget_cap_cents != null ? r.reward_campaigns.budget_cap_cents / 100 : null,
  };
}

export async function savePostEarn(input: PostEarnConfig): Promise<SaveResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const budgetCents = input.budgetUsd != null && Number.isFinite(input.budgetUsd)
    ? Math.max(0, Math.round(input.budgetUsd * 100)) : null;
  const platform = input.platform === "any" ? null : input.platform;

  // A guaranteed base per post (paid on approval) that stacks under the reach/
  // format bonus. Only meaningful for tier/format; flat's amount IS its base.
  const baseCents = Math.max(0, Math.round((input.baseUsd ?? 0) * 100));
  let amountCents: number | null = null;
  let tiers: { min_reach: number; max_reach: number; amount_cents: number }[] | null = null;
  let formatAmounts: Record<string, number> | null = null;
  if (input.model === "flat") {
    amountCents = Math.max(0, Math.round(input.flatUsd * 100));
    if (amountCents <= 0) return { ok: false, error: "Set a credit amount per post." };
  } else if (input.model === "tier") {
    amountCents = baseCents; // guaranteed base
    tiers = input.bands
      .filter((b) => b.usd > 0)
      .map((b) => ({
        min_reach: Math.max(0, Math.round(b.minReach)),
        max_reach: b.maxReach > 0 ? Math.round(b.maxReach) : BIG_REACH,
        amount_cents: Math.round(b.usd * 100),
      }))
      .sort((a, b) => a.min_reach - b.min_reach);
    if (!tiers.length) return { ok: false, error: "Add at least one reach band with an amount." };
  } else {
    amountCents = baseCents; // guaranteed base
    const f = input.formatUsd ?? emptyFormats();
    const built: Record<string, number> = {};
    for (const k of ["reel", "post", "story"] as const) {
      const cents = Math.max(0, Math.round((f[k] ?? 0) * 100));
      if (cents > 0) built[k] = cents;
    }
    if (!Object.keys(built).length) return { ok: false, error: "Set a credit amount for at least one format (reel, post, or story)." };
    formatAmounts = built;
  }
  const media = cleanMedia(input.shareMedia);
  const ruleFields = {
    trigger: "ugc_post" as const,
    platform,
    amount_model: input.model,
    min_order_cents: 0,
    amount_cents: amountCents,
    tiers: tiers as unknown as Json,
    format_amounts: formatAmounts as unknown as Json,
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
    await admin.from("reward_campaigns").update({
      status, budget_cap_cents: budgetCents, share_media: media as unknown as Json,
    }).eq("id", e.campaign_id);
    const { error } = await admin.from("reward_rules").update(ruleFields).eq("id", e.id);
    if (error) return { ok: false, error: "Couldn't save the offer." };
  } else {
    const { data: camp, error: cErr } = await admin.from("reward_campaigns").insert({
      store_id: gate.storeId, name: "Post & Earn", preset: "launch_buzz", status,
      channel_flags: { post_for_credit: true }, budget_cap_cents: budgetCents,
      share_media: media as unknown as Json,
    }).select("id").single();
    if (cErr || !camp) return { ok: false, error: "Couldn't create the campaign." };
    const { error: rErr } = await admin.from("reward_rules").insert({ campaign_id: camp.id, ...ruleFields });
    if (rErr) return { ok: false, error: "Couldn't save the offer." };
  }

  revalidatePath("/campaigns");
  return { ok: true };
}

/** Upload a shareable-media image to the public branding bucket; returns its URL.
 *  Owners only. The client adds the URL to the campaign's shareMedia list. */
export async function uploadShareMedia(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded." };
  if (!file.type.startsWith("image/")) return { ok: false, error: "Please upload an image file." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Image must be under 5 MB." };

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `share-media/${gate.storeId}/${crypto.randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await admin.storage.from("branding").upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data } = admin.storage.from("branding").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
