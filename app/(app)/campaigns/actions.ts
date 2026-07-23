"use server";

import { revalidatePath } from "next/cache";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStore } from "@/lib/store/active-store";
import { POST_PLATFORMS, PLATFORM_FORMATS } from "./post-earn-shared";

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

// ── Post & Earn (post-for-credit) config — one rule per platform ─────────────
export type ReachBand = { minReach: number; maxReach: number; usd: number };
export type ShareMediaItem = { url: string; label?: string | null };
export type PlatformRule = {
  platform: string;                  // instagram | youtube | facebook | tiktok
  enabled: boolean;
  model: "flat" | "tier" | "format";
  flatUsd: number;
  baseUsd: number;                   // guaranteed base per post (stacks under reach/format bonus)
  bands: ReachBand[];
  formatUsd: Record<string, number>; // platform-correct format keys -> dollars
};
export type PostEarnConfig = {
  active: boolean;
  platforms: PlatformRule[];         // every known platform; enabled ones are offered
  promoContext: string;              // "what to promote" — Rani tells customers, reviewers check relevance
  shareMedia: ShareMediaItem[];      // owner-uploaded images Rani hands out to post
  budgetUsd: number | null;          // shared budget across platforms
};

const BIG_REACH = 100_000_000;

function cleanMedia(items: ShareMediaItem[]): ShareMediaItem[] {
  return (items ?? [])
    .filter((m) => m && typeof m.url === "string" && /^https:\/\/\S+$/.test(m.url))
    .slice(0, 8)
    .map((m) => ({ url: m.url, label: m.label?.trim() || null }));
}

function emptyPlatformRule(platform: string): PlatformRule {
  return {
    platform,
    enabled: false,
    model: "flat",
    flatUsd: 5,
    baseUsd: 0,
    bands: [],
    formatUsd: Object.fromEntries((PLATFORM_FORMATS[platform] ?? []).map((k) => [k, 0])),
  };
}

type PostRuleRow = {
  platform: string | null;
  amount_model: "flat" | "tier" | "format";
  amount_cents: number | null;
  tiers: { min_reach?: number; max_reach?: number; amount_cents: number }[] | null;
  format_amounts: Record<string, number> | null;
  reward_campaigns: { status: string; budget_cap_cents: number | null; share_media: ShareMediaItem[] | null; promo_context: string | null };
};

export async function loadPostEarn(): Promise<PostEarnConfig | null> {
  const gate = await requireOwner();
  if (!gate.ok) return null;
  const admin = createAdminClient();
  const { data: rules } = await admin
    .from("reward_rules")
    .select("platform, amount_model, amount_cents, tiers, format_amounts, reward_campaigns!inner(status, store_id, budget_cap_cents, share_media, promo_context)")
    .eq("trigger", "ugc_post")
    .eq("reward_campaigns.store_id", gate.storeId);
  const rows = (rules ?? []) as unknown as PostRuleRow[];
  if (!rows.length) return null;
  const camp = rows[0].reward_campaigns;
  const byPlatform = new Map(rows.filter((r) => r.platform).map((r) => [r.platform!.toLowerCase(), r]));

  const platforms: PlatformRule[] = POST_PLATFORMS.map((p) => {
    const r = byPlatform.get(p);
    if (!r) return emptyPlatformRule(p);
    const fa = r.format_amounts ?? {};
    const keys = PLATFORM_FORMATS[p] ?? [];
    return {
      platform: p,
      enabled: true,
      model: r.amount_model === "tier" ? "tier" : r.amount_model === "format" ? "format" : "flat",
      flatUsd: (r.amount_cents ?? 0) / 100,
      baseUsd: r.amount_model === "flat" ? 0 : (r.amount_cents ?? 0) / 100,
      bands: (r.tiers ?? []).map((t) => ({
        minReach: t.min_reach ?? 0,
        maxReach: t.max_reach && t.max_reach < BIG_REACH ? t.max_reach : 0,
        usd: t.amount_cents / 100,
      })),
      formatUsd: Object.fromEntries(keys.map((k) => [k, (fa[k] ?? 0) / 100])),
    };
  });

  return {
    active: camp.status === "active",
    platforms,
    promoContext: camp.promo_context ?? "",
    shareMedia: cleanMedia((camp.share_media ?? []) as ShareMediaItem[]),
    budgetUsd: camp.budget_cap_cents != null ? camp.budget_cap_cents / 100 : null,
  };
}

type RuleFields = {
  trigger: "ugc_post";
  platform: string;
  amount_model: "flat" | "tier" | "format";
  min_order_cents: number;
  amount_cents: number | null;
  tiers: Json;
  format_amounts: Json;
};

/** Validate one platform's config and build its reward_rules row, or an error. */
function buildRuleFields(pr: PlatformRule): { fields: RuleFields } | { error: string } {
  const baseCents = Math.max(0, Math.round((pr.baseUsd ?? 0) * 100));
  let amountCents: number | null = null;
  let tiers: { min_reach: number; max_reach: number; amount_cents: number }[] | null = null;
  let formatAmounts: Record<string, number> | null = null;
  const name = pr.platform[0].toUpperCase() + pr.platform.slice(1);

  if (pr.model === "flat") {
    amountCents = Math.max(0, Math.round(pr.flatUsd * 100));
    if (amountCents <= 0) return { error: `Set a credit amount for ${name}.` };
  } else if (pr.model === "tier") {
    amountCents = baseCents;
    tiers = (pr.bands ?? [])
      .filter((b) => b.usd > 0)
      .map((b) => ({
        min_reach: Math.max(0, Math.round(b.minReach)),
        max_reach: b.maxReach > 0 ? Math.round(b.maxReach) : BIG_REACH,
        amount_cents: Math.round(b.usd * 100),
      }))
      .sort((a, b) => a.min_reach - b.min_reach);
    if (!tiers.length) return { error: `Add at least one reach band for ${name}.` };
  } else {
    amountCents = baseCents;
    const keys = PLATFORM_FORMATS[pr.platform] ?? [];
    const built: Record<string, number> = {};
    for (const k of keys) {
      const cents = Math.max(0, Math.round((pr.formatUsd?.[k] ?? 0) * 100));
      if (cents > 0) built[k] = cents;
    }
    if (!Object.keys(built).length) return { error: `Set a credit amount for at least one ${name} format.` };
    formatAmounts = built;
  }
  return {
    fields: {
      trigger: "ugc_post" as const,
      platform: pr.platform,
      amount_model: pr.model,
      min_order_cents: 0,
      amount_cents: amountCents,
      tiers: tiers as unknown as Json,
      format_amounts: formatAmounts as unknown as Json,
    },
  };
}

export async function savePostEarn(input: PostEarnConfig): Promise<SaveResult> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const budgetCents = input.budgetUsd != null && Number.isFinite(input.budgetUsd)
    ? Math.max(0, Math.round(input.budgetUsd * 100)) : null;
  const media = cleanMedia(input.shareMedia);
  const promoContext = (input.promoContext ?? "").trim().slice(0, 500) || null;
  const status = input.active ? "active" : "paused";

  // Validate + build the rule row for every enabled platform up front.
  const enabled = (input.platforms ?? []).filter((p) => p.enabled);
  if (!enabled.length) return { ok: false, error: "Enable at least one platform." };
  const built: { platform: string; fields: RuleFields }[] = [];
  for (const pr of enabled) {
    const r = buildRuleFields(pr);
    if ("error" in r) return { ok: false, error: r.error };
    built.push({ platform: pr.platform.toLowerCase(), fields: r.fields });
  }

  const admin = createAdminClient();

  // Find (or create) the store's single Post & Earn campaign.
  const { data: anyRule } = await admin
    .from("reward_rules")
    .select("campaign_id, reward_campaigns!inner(store_id)")
    .eq("trigger", "ugc_post")
    .eq("reward_campaigns.store_id", gate.storeId)
    .limit(1)
    .maybeSingle();
  let campaignId = (anyRule as unknown as { campaign_id: string } | null)?.campaign_id ?? null;
  if (campaignId) {
    await admin.from("reward_campaigns").update({
      status, budget_cap_cents: budgetCents, share_media: media as unknown as Json, promo_context: promoContext,
    }).eq("id", campaignId);
  } else {
    const { data: camp, error: cErr } = await admin.from("reward_campaigns").insert({
      store_id: gate.storeId, name: "Post & Earn", preset: "launch_buzz", status,
      channel_flags: { post_for_credit: true }, budget_cap_cents: budgetCents,
      share_media: media as unknown as Json, promo_context: promoContext,
    }).select("id").single();
    if (cErr || !camp) return { ok: false, error: "Couldn't create the campaign." };
    campaignId = camp.id;
  }
  if (!campaignId) return { ok: false, error: "Couldn't resolve the campaign." };

  // Existing per-platform rules for this campaign.
  const { data: existingRules } = await admin
    .from("reward_rules").select("id, platform").eq("campaign_id", campaignId).eq("trigger", "ugc_post");
  const existingByPlatform = new Map(
    (existingRules ?? []).map((r) => [String(r.platform ?? "").toLowerCase(), r.id as string]),
  );
  const enabledPlatforms = new Set(built.map((b) => b.platform));

  // Upsert each enabled platform's rule.
  for (const b of built) {
    const id = existingByPlatform.get(b.platform);
    const { error } = id
      ? await admin.from("reward_rules").update(b.fields).eq("id", id)
      : await admin.from("reward_rules").insert({ campaign_id: campaignId, ...b.fields });
    if (error) return { ok: false, error: `Couldn't save the ${b.platform} offer.` };
  }

  // Remove rules for known platforms the owner turned off (leaves any legacy
  // catch-all rule untouched).
  const toDelete = (existingRules ?? [])
    .filter((r) => {
      const p = String(r.platform ?? "").toLowerCase();
      return (POST_PLATFORMS as readonly string[]).includes(p) && !enabledPlatforms.has(p);
    })
    .map((r) => r.id as string);
  if (toDelete.length) await admin.from("reward_rules").delete().in("id", toDelete);

  revalidatePath("/campaigns");
  return { ok: true };
}

// ── Results summary (co-marketing ROI) ───────────────────────────────────────
export type CampaignResults = {
  earnedUsd: number;        // total store credit accrued (all time)
  outstandingUsd: number;   // liability: held + released-unexpired credit that could be spent
  redeemedUsd: number;      // credit actually redeemed to date
  referralOrders: number;   // friends' orders driven by Share & Earn
  postsApproved: number;
  postsPending: number;
};

/** Aggregate the store's co-marketing results — what the loops earned customers,
 *  what's outstanding (a liability), what's been redeemed, and activity counts. */
export async function loadResults(): Promise<CampaignResults | null> {
  const gate = await requireOwner();
  if (!gate.ok) return null;
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const [ledgerRes, redRes, evRes, approvedRes, pendingRes] = await Promise.all([
    admin.from("reward_ledger").select("amount_cents, status, expires_at").eq("store_id", gate.storeId).in("status", ["held", "released"]),
    admin.from("reward_redemptions").select("amount_cents, redemption_passes!inner(store_id)").eq("redemption_passes.store_id", gate.storeId),
    admin.from("reward_events").select("computed_amount_cents, source_type, reward_campaigns!inner(store_id)").eq("reward_campaigns.store_id", gate.storeId),
    admin.from("social_submissions").select("id", { count: "exact", head: true }).eq("store_id", gate.storeId).eq("status", "approved"),
    admin.from("social_submissions").select("id", { count: "exact", head: true }).eq("store_id", gate.storeId).eq("status", "submitted"),
  ]);

  let outstanding = 0;
  for (const l of (ledgerRes.data ?? []) as { amount_cents: number; status: string; expires_at: string | null }[]) {
    if (l.status === "held" || (l.status === "released" && (!l.expires_at || l.expires_at > nowIso))) outstanding += Number(l.amount_cents || 0);
  }
  const redeemed = ((redRes.data ?? []) as { amount_cents: number }[]).reduce((s, r) => s + Number(r.amount_cents || 0), 0);
  let earned = 0, referralOrders = 0;
  for (const e of (evRes.data ?? []) as { computed_amount_cents: number; source_type: string }[]) {
    earned += Number(e.computed_amount_cents || 0);
    if (e.source_type === "referral_order") referralOrders++;
  }

  return {
    earnedUsd: earned / 100,
    outstandingUsd: outstanding / 100,
    redeemedUsd: redeemed / 100,
    referralOrders,
    postsApproved: approvedRes.count ?? 0,
    postsPending: pendingRes.count ?? 0,
  };
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
