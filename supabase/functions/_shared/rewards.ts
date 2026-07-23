// Co-marketing rewards — the credit engine (Increment 1).
//
// Pure server-side, service-role only. The money-moving, must-be-atomic bits
// (balance, redemption) are SQL functions (migration 0060) called via rpc();
// this module wraps them and handles the non-atomic accrual + pass issuance.
//
// Money is INTEGER CENTS everywhere. The ledger is append-only + status
// transitions; balance is DERIVED (reward_balance rpc), never stored.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ── reward_rules amount shapes ───────────────────────────────────────────────
export type RewardRule = {
  id: string;
  amount_model: "flat" | "percent" | "tier" | "format";
  amount_cents: number | null;
  percent_bps: number | null; // basis points: 500 = 5%
  tiers: Array<{ min_reach?: number; max_reach?: number; amount_cents: number }> | null;
  format_amounts: Record<string, number> | null; // {reel,post,story} -> cents (amount_model 'format')
  min_order_cents: number;
};

/** What the initiator earns on a referred order. `reach` drives the post tiers
 *  and `format` the per-format amounts (Increment 2); referral rules use
 *  flat/percent against the net order. */
export function computeAmountCents(
  rule: RewardRule,
  opts: { netOrderCents?: number; reach?: number; format?: string | null } = {},
): number {
  const net = Math.max(0, Math.floor(opts.netOrderCents ?? 0));
  if (net < (rule.min_order_cents ?? 0)) return 0;
  switch (rule.amount_model) {
    case "flat":
      return Math.max(0, Math.floor(rule.amount_cents ?? 0));
    case "percent":
      return Math.max(0, Math.floor((net * (rule.percent_bps ?? 0)) / 10000));
    case "tier": {
      // amount_cents is an optional guaranteed base; the matched reach band
      // stacks on top (base + performance). No band -> just the base.
      const base = Math.max(0, Math.floor(rule.amount_cents ?? 0));
      const r = opts.reach ?? 0;
      const band = (rule.tiers ?? []).find(
        (t) => r >= (t.min_reach ?? 0) && r <= (t.max_reach ?? Number.MAX_SAFE_INTEGER),
      );
      return base + (band ? Math.max(0, Math.floor(band.amount_cents)) : 0);
    }
    case "format": {
      // amount_cents is an optional guaranteed base; the post's format stacks
      // on top (base + performance). Unpriced format -> just the base.
      const base = Math.max(0, Math.floor(rule.amount_cents ?? 0));
      const key = String(opts.format ?? "").toLowerCase();
      const cents = (rule.format_amounts ?? {})[key];
      return base + (cents ? Math.max(0, Math.floor(cents)) : 0);
    }
  }
}

// ── balance ──────────────────────────────────────────────────────────────────
export async function rewardBalanceCents(
  db: SupabaseClient,
  storeId: string,
  memberId: string,
): Promise<number> {
  const { data, error } = await db.rpc("reward_balance", {
    p_store_id: storeId,
    p_member_id: memberId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

// ── accrual ──────────────────────────────────────────────────────────────────
export type AccrueResult =
  | { status: "held"; ledgerId: string; amountCents: number }
  | { status: "capped"; amountCents: number }
  | { status: "duplicate" }
  | { status: "skipped" };

/** Accrue a referral reward for the initiator. Idempotent on (campaign, source):
 *  a re-fire for the same order does nothing. Enforces the campaign budget cap —
 *  past the cap, credit accrues as pending (not spendable) and is not counted. */
export async function accrueReferralReward(
  db: SupabaseClient,
  args: {
    storeId: string;
    campaignId: string;
    initiatorMemberId: string;
    sourceOrderId: string;
    amountCents: number;
    productSku?: string | null;
    fundingSource?: string; // 'store' | 'supplier:<id>'
    sourceType?: string; // default 'referral_order'
  },
): Promise<AccrueResult> {
  if (!args.amountCents || args.amountCents <= 0) return { status: "skipped" };
  const sourceType = args.sourceType ?? "referral_order";

  const { data: camp } = await db
    .from("reward_campaigns")
    .select("hold_hours, budget_cap_cents, budget_spent_cents")
    .eq("id", args.campaignId)
    .maybeSingle();
  if (!camp) return { status: "skipped" };

  const overCap = camp.budget_cap_cents != null &&
    (Number(camp.budget_spent_cents ?? 0) + args.amountCents) > Number(camp.budget_cap_cents);

  // Idempotent accrual fact. A duplicate (same campaign+source) hits the unique
  // index -> we treat it as already-rewarded and stop.
  const { data: ev, error: evErr } = await db
    .from("reward_events")
    .insert({
      campaign_id: args.campaignId,
      member_id: args.initiatorMemberId,
      source_type: sourceType,
      source_id: args.sourceOrderId,
      product_sku: args.productSku ?? null,
      funding_source: args.fundingSource ?? "store",
      computed_amount_cents: args.amountCents,
      status: overCap ? "capped" : "accrued",
      flags: overCap ? { over_budget: true } : {},
    })
    .select("id")
    .single();
  if (evErr) {
    // 23505 = unique_violation on (campaign, source_type, source_id): already done.
    // deno-lint-ignore no-explicit-any
    if ((evErr as any).code === "23505") return { status: "duplicate" };
    throw evErr;
  }

  if (overCap) {
    // Park it as pending (not spendable). Owner is notified to lift the cap.
    await db.from("reward_ledger").insert({
      store_id: args.storeId,
      member_id: args.initiatorMemberId,
      campaign_id: args.campaignId,
      reward_event_id: ev.id,
      amount_cents: args.amountCents,
      kind: "store_credit",
      status: "pending",
    });
    return { status: "capped", amountCents: args.amountCents };
  }

  const holdUntil = new Date(Date.now() + Number(camp.hold_hours ?? 72) * 3600_000).toISOString();
  const { data: led, error: ledErr } = await db
    .from("reward_ledger")
    .insert({
      store_id: args.storeId,
      member_id: args.initiatorMemberId,
      campaign_id: args.campaignId,
      reward_event_id: ev.id,
      amount_cents: args.amountCents,
      kind: "store_credit",
      status: "held",
      hold_until: holdUntil,
    })
    .select("id")
    .single();
  if (ledErr) throw ledErr;

  // Optimistic budget tally (a small cap overshoot under concurrency is fine).
  await db
    .from("reward_campaigns")
    .update({ budget_spent_cents: Number(camp.budget_spent_cents ?? 0) + args.amountCents })
    .eq("id", args.campaignId);

  return { status: "held", ledgerId: led.id, amountCents: args.amountCents };
}

/** Generic accrual (post-for-credit, influencer, …) — the SAME engine as the
 *  referral path. `earnerMemberId` gets the credit; `sourceId` is the idempotency
 *  key (unique per campaign+sourceType+sourceId). */
export function accrueReward(
  db: SupabaseClient,
  args: {
    storeId: string;
    campaignId: string;
    earnerMemberId: string;
    sourceType: string;
    sourceId: string;
    amountCents: number;
    productSku?: string | null;
    fundingSource?: string;
  },
): Promise<AccrueResult> {
  return accrueReferralReward(db, {
    storeId: args.storeId,
    campaignId: args.campaignId,
    initiatorMemberId: args.earnerMemberId,
    sourceOrderId: args.sourceId,
    amountCents: args.amountCents,
    productSku: args.productSku,
    fundingSource: args.fundingSource,
    sourceType: args.sourceType,
  });
}

// ── redemption pass ──────────────────────────────────────────────────────────
const PASS_TTL_MS = 15 * 60_000;

function code4(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}
function token(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export type Pass = {
  id: string;
  code4: string;
  qr_token: string;
  amount_cents: number;
  first_name: string | null;
  expires_at: string;
};

/** Issue a redemption pass for up to the member's spendable balance. Returns
 *  null if they have no credit to spend. Unused passes expire harmlessly — the
 *  credit is never burned by pass expiry. */
export async function issueRedemptionPass(
  db: SupabaseClient,
  args: { storeId: string; memberId: string; requestedCents?: number; firstName?: string | null },
): Promise<Pass | null> {
  const balance = await rewardBalanceCents(db, args.storeId, args.memberId);
  if (balance <= 0) return null;
  const amount = args.requestedCents && args.requestedCents > 0
    ? Math.min(args.requestedCents, balance)
    : balance;
  const { data, error } = await db
    .from("redemption_passes")
    .insert({
      store_id: args.storeId,
      member_id: args.memberId,
      code4: code4(),
      qr_token: token(),
      amount_cents: amount,
      first_name: args.firstName ?? null,
      status: "active",
      expires_at: new Date(Date.now() + PASS_TTL_MS).toISOString(),
    })
    .select("id, code4, qr_token, amount_cents, first_name, expires_at")
    .single();
  if (error) throw error;
  return data as Pass;
}

/** Resolve an active pass by its QR token (staff scan surface). */
export async function passByToken(db: SupabaseClient, qrToken: string) {
  const { data } = await db
    .from("redemption_passes")
    .select("id, store_id, member_id, amount_cents, first_name, status, expires_at")
    .eq("qr_token", qrToken)
    .maybeSingle();
  return data ?? null;
}

/** Resolve an active pass by the 4-digit code within a store (panel surface). */
export async function passByCode(db: SupabaseClient, storeId: string, code: string) {
  const { data } = await db
    .from("redemption_passes")
    .select("id, store_id, member_id, amount_cents, first_name, status, expires_at")
    .eq("store_id", storeId)
    .eq("code4", code)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export type RedeemResult = {
  ok: boolean;
  error?: string;
  redeemed_cents?: number;
  remaining_balance_cents?: number;
};

/** Confirm a redemption atomically (row-locked in SQL). `billCents` = the actual
 *  bill for a partial redemption; omit to redeem the pass's full amount. */
export async function confirmRedemption(
  db: SupabaseClient,
  args: {
    passId: string;
    surface: "qr" | "panel_code" | "phone_lookup";
    staffId?: string | null;
    orderRef?: string | null;
    billCents?: number | null;
  },
): Promise<RedeemResult> {
  const { data, error } = await db.rpc("confirm_redemption", {
    p_pass_id: args.passId,
    p_surface: args.surface,
    p_staff_id: args.staffId ?? null,
    p_order_ref: args.orderRef ?? null,
    p_bill_cents: args.billCents ?? null,
  });
  if (error) throw error;
  return (data ?? { ok: false, error: "unknown" }) as RedeemResult;
}
