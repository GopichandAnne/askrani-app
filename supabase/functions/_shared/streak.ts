// Owner-configurable "share streak" bonus. A regular who earns N times in a
// calendar month (real, CONFIRMED earns — a referred friend actually ordered, or
// a post was approved) gets a one-off bonus. Money safety by construction:
//   - the goal counts CONFIRMED reward_events only (hard to game),
//   - the bonus is idempotent per (member, month) via reward_events' unique key,
//   - it accrues into a per-store system campaign whose budget_cap is the owner's
//     monthly ceiling (over cap → parked as non-spendable pending),
//   - it's owner-opt-in (goal & amount are 0/unset by default).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";

const EARN_SOURCE_TYPES = ["referral_order", "ugc_post", "influencer"];
const STREAK_PRESET = "streak_bonus";

export type StreakConfig = { goal: number; bonusCents: number; capCents: number | null };

export async function streakConfig(db: SupabaseClient, storeId: string): Promise<StreakConfig> {
  const { data } = await db
    .from("agent_config")
    .select("key, value")
    .eq("store_id", storeId)
    .in("key", ["streak_goal", "streak_bonus_cents", "streak_cap_cents"]);
  const c = Object.fromEntries((data ?? []).map((r) => [r.key, String(r.value ?? "")]));
  const goal = Math.max(0, Math.floor(Number(c.streak_goal ?? 0)) || 0);
  const bonusCents = Math.max(0, Math.round(Number(c.streak_bonus_cents ?? 0)) || 0);
  const cap = c.streak_cap_cents != null && c.streak_cap_cents !== "" ? Math.round(Number(c.streak_cap_cents)) : NaN;
  return { goal, bonusCents, capCents: Number.isFinite(cap) ? cap : null };
}

function monthKey(): { ym: string; iso: string } {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return { ym, iso: start.toISOString() };
}

/** Count this member's CONFIRMED earns this month (real referral orders + approved
 *  posts). This is the streak metric — not links merely created (which would be
 *  gameable). */
export async function confirmedEarnsThisMonth(db: SupabaseClient, storeId: string, memberId: string): Promise<number> {
  const { iso } = monthKey();
  const { count } = await db
    .from("reward_events")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .in("source_type", EARN_SOURCE_TYPES)
    .gte("created_at", iso);
  return count ?? 0;
}

async function getOrCreateStreakCampaign(db: SupabaseClient, storeId: string, capCents: number | null): Promise<string | null> {
  const { data: existing } = await db
    .from("reward_campaigns")
    .select("id")
    .eq("store_id", storeId)
    .eq("preset", STREAK_PRESET)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    // keep the owner's monthly ceiling in sync
    await db.from("reward_campaigns").update({ budget_cap_cents: capCents }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await db
    .from("reward_campaigns")
    .insert({ store_id: storeId, name: "Share streak bonus", preset: STREAK_PRESET, status: "active", budget_cap_cents: capCents, hold_hours: 24 })
    .select("id")
    .single();
  if (error) {
    console.error(`[streak] campaign: ${error.message}`);
    return null;
  }
  return data.id;
}

export type StreakResult = { enabled: boolean; goal: number; bonusCents: number; awarded: boolean };

/** Lazily award the streak bonus if the member has reached the goal this month
 *  and hasn't been awarded yet. Idempotent + capped. `awarded` is true only on the
 *  transition (so the diner can celebrate once). */
export async function maybeAwardStreakBonus(
  db: SupabaseClient,
  store: Store,
  memberId: string,
  confirmedCount: number,
): Promise<StreakResult> {
  const cfg = await streakConfig(db, store.id);
  if (cfg.goal <= 0 || cfg.bonusCents <= 0) return { enabled: false, goal: cfg.goal, bonusCents: cfg.bonusCents, awarded: false };
  if (confirmedCount < cfg.goal) return { enabled: true, goal: cfg.goal, bonusCents: cfg.bonusCents, awarded: false };

  const campaignId = await getOrCreateStreakCampaign(db, store.id, cfg.capCents);
  if (!campaignId) return { enabled: true, goal: cfg.goal, bonusCents: cfg.bonusCents, awarded: false };

  const { ym } = monthKey();
  const sourceId = `${memberId}-${ym}`;

  // Budget ceiling for the month.
  const { data: camp } = await db
    .from("reward_campaigns")
    .select("budget_cap_cents, budget_spent_cents")
    .eq("id", campaignId)
    .maybeSingle();
  if (!camp) return { enabled: true, goal: cfg.goal, bonusCents: cfg.bonusCents, awarded: false };
  const overCap = camp.budget_cap_cents != null &&
    (Number(camp.budget_spent_cents ?? 0) + cfg.bonusCents) > Number(camp.budget_cap_cents);

  // Idempotent fact — one bonus per (member, month). A re-check hits the unique
  // (campaign, source_type, source_id) index and no-ops.
  const { data: ev, error: evErr } = await db
    .from("reward_events")
    .insert({
      campaign_id: campaignId,
      member_id: memberId,
      source_type: STREAK_PRESET,
      source_id: sourceId,
      computed_amount_cents: cfg.bonusCents,
      status: overCap ? "capped" : "accrued",
      funding_source: "store",
      flags: overCap ? { over_budget: true } : {},
    })
    .select("id")
    .single();
  if (evErr) {
    // deno-lint-ignore no-explicit-any
    if ((evErr as any).code === "23505") return { enabled: true, goal: cfg.goal, bonusCents: cfg.bonusCents, awarded: false };
    console.error(`[streak] event: ${evErr.message}`);
    return { enabled: true, goal: cfg.goal, bonusCents: cfg.bonusCents, awarded: false };
  }

  // Over the cap → park as non-spendable pending (owner can lift). Not "awarded".
  if (overCap) {
    await db.from("reward_ledger").insert({
      store_id: store.id, member_id: memberId, campaign_id: campaignId, reward_event_id: ev.id,
      amount_cents: cfg.bonusCents, kind: "store_credit", status: "pending",
    });
    return { enabled: true, goal: cfg.goal, bonusCents: cfg.bonusCents, awarded: false };
  }

  // Instant, spendable (Gen-Z instant gratification).
  await db.from("reward_ledger").insert({
    store_id: store.id, member_id: memberId, campaign_id: campaignId, reward_event_id: ev.id,
    amount_cents: cfg.bonusCents, kind: "store_credit", status: "released",
  });
  await db.from("reward_campaigns")
    .update({ budget_spent_cents: Number(camp.budget_spent_cents ?? 0) + cfg.bonusCents })
    .eq("id", campaignId);
  return { enabled: true, goal: cfg.goal, bonusCents: cfg.bonusCents, awarded: true };
}
