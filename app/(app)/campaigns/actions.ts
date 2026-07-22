"use server";

import { revalidatePath } from "next/cache";
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
  // deno-lint-ignore no-explicit-any
  const r = rule as any;
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
    // deno-lint-ignore no-explicit-any
    const e = existing as any;
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
