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

/** The store's active post-for-credit (ugc_post) campaign + rule + any
 *  owner-uploaded shareable media, or null. */
export async function activePostRule(
  db: SupabaseClient,
  storeId: string,
): Promise<{ campaignId: string; rule: PostRule; shareMedia: ShareMedia[] } | null> {
  const { data } = await db
    .from("reward_rules")
    .select(`${RULE_COLS}, campaign_id, reward_campaigns!inner(status, store_id, share_media)`)
    .eq("trigger", "ugc_post")
    .eq("reward_campaigns.store_id", storeId)
    .eq("reward_campaigns.status", "active")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  const media: ShareMedia[] = Array.isArray(d.reward_campaigns?.share_media)
    ? d.reward_campaigns.share_media.filter((m: unknown) => {
      const u = (m as ShareMedia)?.url;
      return typeof u === "string" && /^https:\/\/\S+$/.test(u);
    })
    : [];
  return { campaignId: d.campaign_id, rule: d as PostRule, shareMedia: media };
}

/** Format keys the 'format' pricing model prices — for describing the offer and
 *  validating a reviewer's pick. */
export const POST_FORMATS = ["reel", "post", "story"] as const;

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

  const active = await activePostRule(db, store.id);
  if (!active) return { ok: false, reason: "no_active_offer", note: "No post-for-credit offer is running — don't promise a reward." };

  if (!args.disclosureConfirmed) {
    return { ok: false, reason: "needs_disclosure", note: "They must confirm the post includes the required disclosure tag (#ad or #gifted) before you submit it." };
  }
  const url = args.postUrl.trim();
  if (!/^https?:\/\/\S+/i.test(url)) {
    return { ok: false, reason: "bad_url", note: "That doesn't look like a post link — ask them to paste the full URL." };
  }

  const { data, error } = await db
    .from("social_submissions")
    .insert({
      store_id: store.id,
      campaign_id: active.campaignId,
      rule_id: active.rule.id,
      member_id: memberId,
      platform: args.platform ?? active.rule.platform ?? null,
      format: args.format ?? active.rule.format ?? null,
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
  if (!rule) rule = (await activePostRule(db, sub.store_id))?.rule ?? null;
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
