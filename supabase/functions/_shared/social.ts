// Post-for-credit (Increment 2): a customer posts about the store on IG/YouTube/
// FB and pastes the URL -> a human reviews it -> on approval, credit accrues
// through the SAME engine as the give-and-get loop. Reject leaves no ledger entry.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { accrueReward, computeAmountCents, type RewardRule } from "./rewards.ts";
import { resolveMember } from "./members.ts";

type PostRule = RewardRule & { platform: string | null; format: string | null };
export type ShareMedia = { url: string; label?: string | null };
const RULE_COLS = "id, amount_model, amount_cents, percent_bps, tiers, format_amounts, min_order_cents, platform, format";

/** Formats that make sense per platform (a reel is Instagram/Facebook, a short
 *  is YouTube, etc.). Keys are lowercase platform ids; default covers the rest. */
export const PLATFORM_FORMATS: Record<string, string[]> = {
  instagram: ["reel", "post", "story"],
  facebook: ["reel", "post", "story"],
  youtube: ["video", "short"],
  tiktok: ["video", "photo"],
};
export function formatsForPlatform(platform: string | null | undefined): string[] {
  return PLATFORM_FORMATS[String(platform ?? "").toLowerCase()] ?? ["reel", "post", "story"];
}

/** Best-effort platform from a pasted post URL, so the customer doesn't have to
 *  tell us which network it is. */
export function platformFromUrl(url: string): string | null {
  const u = String(url ?? "").toLowerCase();
  if (/instagram\.com|instagr\.am/.test(u)) return "instagram";
  if (/youtube\.com|youtu\.be/.test(u)) return "youtube";
  if (/facebook\.com|fb\.watch|fb\.com/.test(u)) return "facebook";
  if (/tiktok\.com/.test(u)) return "tiktok";
  return null;
}

export type PostCampaign = { campaignId: string; rules: PostRule[]; shareMedia: ShareMedia[] };

/** The store's active Post & Earn campaign: ALL its ugc_post rules (one per
 *  platform) plus shareable media. Null when no offer is running. */
export async function activePostCampaign(
  db: SupabaseClient,
  storeId: string,
): Promise<PostCampaign | null> {
  const { data } = await db
    .from("reward_rules")
    .select(`${RULE_COLS}, campaign_id, reward_campaigns!inner(status, store_id, share_media)`)
    .eq("trigger", "ugc_post")
    .eq("reward_campaigns.store_id", storeId)
    .eq("reward_campaigns.status", "active");
  // deno-lint-ignore no-explicit-any
  const rows = (data ?? []) as any[];
  if (!rows.length) return null;
  const media: ShareMedia[] = Array.isArray(rows[0].reward_campaigns?.share_media)
    ? rows[0].reward_campaigns.share_media.filter((m: unknown) => {
      const u = (m as ShareMedia)?.url;
      return typeof u === "string" && /^https:\/\/\S+$/.test(u);
    })
    : [];
  return { campaignId: rows[0].campaign_id, rules: rows.map((r) => r as PostRule), shareMedia: media };
}

/** Pick the rule for a platform: exact match first, then a catch-all rule
 *  (platform null), else null (no offer for that platform). */
export function pickRuleForPlatform(rules: PostRule[], platform: string | null): PostRule | null {
  const p = String(platform ?? "").toLowerCase();
  return (p ? rules.find((r) => (r.platform ?? "").toLowerCase() === p) : undefined) ??
    rules.find((r) => !r.platform) ?? null;
}

/** One-line payout summary for a platform rule, for Rani to quote the offer. */
export function describeRuleOffer(rule: PostRule): string {
  const name = rule.platform ? rule.platform[0].toUpperCase() + rule.platform.slice(1) : "Any platform";
  const base = (rule.amount_model === "tier" || rule.amount_model === "format")
    ? Math.max(0, Math.round(Number(rule.amount_cents ?? 0))) : 0;
  if (rule.amount_model === "flat") {
    return `${name}: $${(Number(rule.amount_cents ?? 0) / 100).toFixed(2)} per post`;
  }
  if (rule.amount_model === "format") {
    const fa = rule.format_amounts ?? {};
    const parts = formatsForPlatform(rule.platform)
      .filter((f) => Number(fa[f] ?? 0) > 0)
      .map((f) => `${f} $${((base + Number(fa[f])) / 100).toFixed(2)}`);
    return `${name}: ${parts.join(", ") || "store credit"}`;
  }
  return `${name}: credit by reach${base > 0 ? ` (+$${(base / 100).toFixed(2)} base)` : ""}`;
}

export type SubmitResult =
  | { ok: true; submissionId: string; note: string }
  | { ok: false; reason: string; note: string };

/** Record a post submission (status 'submitted') for the store's active offer. */
export async function createPostSubmission(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  args: { postUrl: string; platform?: string | null; format?: string | null; disclosureConfirmed: boolean },
): Promise<SubmitResult> {
  let memberId = (await resolveMember(db, store, sessionId))?.id ?? null;
  if (!memberId && sessionId.startsWith("wa_")) {
    const ins = await db.from("store_members").insert({ store_id: store.id, phone: sessionId.slice(3) }).select("id").maybeSingle();
    memberId = ins.data?.id ?? (await resolveMember(db, store, sessionId))?.id ?? null;
  }
  if (!memberId) {
    return { ok: false, reason: "needs_identity", note: "Ask them to verify their identity (or continue on WhatsApp), then submit again." };
  }

  const camp = await activePostCampaign(db, store.id);
  if (!camp) return { ok: false, reason: "no_active_offer", note: "No post-for-credit offer is running — don't promise a reward." };

  const url = args.postUrl.trim();
  if (!/^https?:\/\/\S+/i.test(url)) {
    return { ok: false, reason: "bad_url", note: "That doesn't look like a post link — ask them to paste the full URL." };
  }

  // Match the post to a platform (their hint, else inferred from the URL), then
  // to that platform's rule. No matching rule -> we don't pay for that platform.
  const platform = (args.platform ?? platformFromUrl(url) ?? "").toLowerCase() || null;
  const rule = pickRuleForPlatform(camp.rules, platform);
  if (!rule) {
    const offered = camp.rules.map((r) => r.platform).filter(Boolean).join(", ");
    return {
      ok: false,
      reason: "platform_not_offered",
      note: `No post-for-credit offer for that platform${platform ? ` (${platform})` : ""}. It runs on: ${offered || "no platforms"}. Don't promise a reward for an unsupported platform.`,
    };
  }

  if (!args.disclosureConfirmed) {
    return { ok: false, reason: "needs_disclosure", note: "They must confirm the post includes the required disclosure tag (#ad or #gifted) before you submit it." };
  }

  const { data, error } = await db
    .from("social_submissions")
    .insert({
      store_id: store.id,
      campaign_id: camp.campaignId,
      rule_id: rule.id,
      member_id: memberId,
      platform: platform ?? rule.platform ?? null,
      format: args.format ?? null, // reviewer picks the format at approval
      post_url: url,
      disclosure_confirmed: true,
      status: "submitted",
    })
    .select("id")
    .single();
  if (error) {
    // deno-lint-ignore no-explicit-any
    if ((error as any).code === "23505") return { ok: false, reason: "duplicate", note: "They already submitted that post — it's pending review." };
    throw error;
  }
  return { ok: true, submissionId: data.id, note: "Submitted for review. Credit lands once the store approves the post." };
}

export type ApproveResult =
  | { ok: true; amountCents: number; status: string }
  | { ok: false; reason: string };

/** Approve a submission: compute the credit (flat, the reach band for the
 *  entered reach, or the amount for the reviewer-picked format) and accrue it.
 *  Idempotent — only 'submitted' rows approve. */
export async function approvePostSubmission(
  db: SupabaseClient,
  args: { submissionId: string; staffId?: string | null; reach?: number | null; format?: string | null },
): Promise<ApproveResult> {
  const { data: sub } = await db
    .from("social_submissions")
    .select("id, store_id, campaign_id, rule_id, member_id, status, format")
    .eq("id", args.submissionId)
    .maybeSingle();
  if (!sub) return { ok: false, reason: "not_found" };
  if (sub.status !== "submitted") return { ok: false, reason: `already_${sub.status}` };

  let rule: PostRule | null = null;
  if (sub.rule_id) {
    const { data } = await db.from("reward_rules").select(RULE_COLS).eq("id", sub.rule_id).maybeSingle();
    rule = (data as PostRule) ?? null;
  }
  if (!rule) rule = (await activePostCampaign(db, sub.store_id))?.rules[0] ?? null;
  if (!rule) return { ok: false, reason: "no_rule" };

  // For the per-format model the reviewer picks the format at approval; fall
  // back to whatever was recorded on the submission.
  const format = (args.format ?? sub.format ?? null) as string | null;
  if (rule.amount_model === "format" && !format) return { ok: false, reason: "needs_format" };
  const amountCents = computeAmountCents(rule, { reach: args.reach ?? 0, format });

  // Mark approved (with the reviewer, reach, and chosen format) regardless of
  // the computed amount.
  await db
    .from("social_submissions")
    .update({
      status: "approved",
      claimed_reach: args.reach ?? null,
      format: format ?? undefined,
      reviewed_by: args.staffId ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", sub.id)
    .eq("status", "submitted");

  if (amountCents <= 0) return { ok: true, amountCents: 0, status: "approved_no_credit" };

  const res = await accrueReward(db, {
    storeId: sub.store_id,
    campaignId: sub.campaign_id,
    earnerMemberId: sub.member_id,
    sourceType: "ugc_post",
    sourceId: sub.id,
    amountCents,
  });
  return { ok: true, amountCents, status: res.status };
}

export async function rejectPostSubmission(
  db: SupabaseClient,
  args: { submissionId: string; staffId?: string | null; note?: string | null },
): Promise<{ ok: boolean }> {
  const { error } = await db
    .from("social_submissions")
    .update({
      status: "rejected",
      reviewed_by: args.staffId ?? null,
      reviewed_at: new Date().toISOString(),
      review_note: args.note ?? null,
    })
    .eq("id", args.submissionId)
    .eq("status", "submitted");
  return { ok: !error };
}
