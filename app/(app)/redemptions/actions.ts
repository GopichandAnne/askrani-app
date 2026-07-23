"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStore } from "@/lib/store/active-store";

// Redemption confirmation surfaces (control panel). The reward tables are
// service-role-only (RLS), so we read/write them through the admin client — but
// every action is gated first on the caller being active staff of the store.
// Any staff role may confirm a redemption (owner / staff / redemption-only).

export type PassMatch = {
  passId: string;
  name: string | null;
  amountUsd: number;
  balanceUsd: number;
  expiresAt: string;
};
export type PhoneMatch = {
  memberId: string;
  name: string | null;
  phoneMasked: string;
  balanceUsd: number;
};
export type ConfirmResult =
  | { ok: true; redeemedUsd: number; remainingUsd: number }
  | { ok: false; error: string };
type LookupResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Gate: the caller must be active staff (any role) of the active store. Returns
 *  the store + the caller's staff row id (for the audit trail). */
async function requireStaff(): Promise<
  { ok: true; storeId: string; staffId: string | null } | { ok: false; error: string }
> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  // getActiveStore only returns stores the user can access, so being here means
  // they are staff (or a platform admin). Look up the staff row id to log who
  // confirmed; a platform admin without a staff row logs as null.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: staff } = await supabase
    .from("staff")
    .select("id")
    .eq("store_id", ctx.active.id)
    .eq("user_id", user?.id ?? "")
    .maybeSingle();
  return { ok: true, storeId: ctx.active.id, staffId: staff?.id ?? null };
}

async function balanceUsd(admin: ReturnType<typeof createAdminClient>, storeId: string, memberId: string): Promise<number> {
  const { data } = await admin.rpc("reward_balance", { p_store_id: storeId, p_member_id: memberId });
  return Number(data ?? 0) / 100;
}

/** Look up an active pass by its 4-digit code (default grocery/counter surface). */
export async function lookupByCode(code: string): Promise<LookupResult<PassMatch>> {
  const gate = await requireStaff();
  if (!gate.ok) return gate;
  const clean = code.replace(/\D/g, "").slice(0, 4);
  if (clean.length !== 4) return { ok: false, error: "Enter the 4-digit code." };
  const admin = createAdminClient();
  const { data: pass } = await admin
    .from("redemption_passes")
    .select("id, member_id, amount_cents, first_name, expires_at, status")
    .eq("store_id", gate.storeId)
    .eq("code4", clean)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pass) return { ok: false, error: "No active code matches — it may have expired. Ask them to tap “use my credit” again." };
  return {
    ok: true,
    data: {
      passId: pass.id,
      name: pass.first_name,
      amountUsd: pass.amount_cents / 100,
      balanceUsd: await balanceUsd(admin, gate.storeId, pass.member_id),
      expiresAt: pass.expires_at,
    },
  };
}

/** Confirm a pass. `billUsd` (optional) = a smaller actual bill for partial redeem. */
export async function confirmPass(passId: string, billUsd?: number): Promise<ConfirmResult> {
  const gate = await requireStaff();
  if (!gate.ok) return gate;
  const admin = createAdminClient();
  const billCents = billUsd != null && Number.isFinite(billUsd) ? Math.round(billUsd * 100) : null;

  // If the store sets a minimum purchase, the bill is required to check it.
  const { data: st } = await admin.from("stores").select("redemption_rules").eq("id", gate.storeId).maybeSingle();
  const minCents = Number((st?.redemption_rules as { min_bill_cents?: number } | null)?.min_bill_cents ?? 0);
  if (minCents > 0 && billCents == null) {
    return { ok: false, error: `Enter the bill total — redemption needs a minimum $${(minCents / 100).toFixed(2)} purchase.` };
  }
  // supabase's type-gen marks all SQL function args non-nullable, but these are
  // nullable in SQL (staff/order-ref optional; a null bill = redeem the full pass).
  const { data, error } = await admin.rpc("confirm_redemption", {
    p_pass_id: passId,
    p_surface: "panel_code",
    p_staff_id: gate.staffId as string,
    p_order_ref: null as unknown as string,
    p_bill_cents: billCents as number,
  });
  if (error) return { ok: false, error: "Couldn't confirm — please try again." };
  const r = data as { ok: boolean; error?: string; redeemed_cents?: number; remaining_balance_cents?: number };
  if (!r?.ok) return { ok: false, error: friendlyErr(r?.error) };
  revalidatePath("/redemptions");
  return { ok: true, redeemedUsd: (r.redeemed_cents ?? 0) / 100, remainingUsd: (r.remaining_balance_cents ?? 0) / 100 };
}

/** Fallback surface: find customers by the last 4 digits of their phone. */
export async function lookupByPhone(last4: string): Promise<LookupResult<PhoneMatch[]>> {
  const gate = await requireStaff();
  if (!gate.ok) return gate;
  const clean = last4.replace(/\D/g, "").slice(-4);
  if (clean.length !== 4) return { ok: false, error: "Enter the last 4 digits of their phone." };
  const admin = createAdminClient();
  const { data: members } = await admin
    .from("store_members")
    .select("id, display_name, phone")
    .eq("store_id", gate.storeId)
    .not("phone", "is", null)
    .like("phone", `%${clean}`);
  const out: PhoneMatch[] = [];
  for (const m of members ?? []) {
    const bal = await balanceUsd(admin, gate.storeId, m.id);
    if (bal > 0) {
      out.push({
        memberId: m.id,
        name: m.display_name,
        phoneMasked: `••• ${String(m.phone).replace(/\D/g, "").slice(-4)}`,
        balanceUsd: bal,
      });
    }
  }
  if (out.length === 0) return { ok: false, error: "No customer with credit matches those digits." };
  return { ok: true, data: out };
}

/** Confirm a redemption for a phone-matched customer (issues a pass then confirms
 *  it, so the staff + surface are logged the same way). Requires verbal check. */
export async function confirmByPhone(memberId: string, amountUsd: number): Promise<ConfirmResult> {
  const gate = await requireStaff();
  if (!gate.ok) return gate;
  const amountCents = Math.round(amountUsd * 100);
  if (!(amountCents > 0)) return { ok: false, error: "Enter an amount to redeem." };
  const admin = createAdminClient();
  const bal = Math.round((await balanceUsd(admin, gate.storeId, memberId)) * 100);
  if (bal <= 0) return { ok: false, error: "That customer has no credit to redeem." };
  const { data: pass, error: passErr } = await admin
    .from("redemption_passes")
    .insert({
      store_id: gate.storeId,
      member_id: memberId,
      code4: String(Math.floor(1000 + Math.random() * 9000)),
      qr_token: crypto.randomUUID().replace(/-/g, ""),
      amount_cents: bal,
      status: "active",
      expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (passErr || !pass) return { ok: false, error: "Couldn't start the redemption — please try again." };
  const { data, error } = await admin.rpc("confirm_redemption", {
    p_pass_id: pass.id,
    p_surface: "phone_lookup",
    p_staff_id: gate.staffId as string, // nullable in SQL; type-gen over-strict
    p_order_ref: null as unknown as string,
    p_bill_cents: Math.min(amountCents, bal),
  });
  if (error) return { ok: false, error: "Couldn't confirm — please try again." };
  const r = data as { ok: boolean; error?: string; redeemed_cents?: number; remaining_balance_cents?: number };
  if (!r?.ok) return { ok: false, error: friendlyErr(r?.error) };
  revalidatePath("/redemptions");
  return { ok: true, redeemedUsd: (r.redeemed_cents ?? 0) / 100, remainingUsd: (r.remaining_balance_cents ?? 0) / 100 };
}

function friendlyErr(code?: string): string {
  switch (code) {
    case "pass_confirmed": return "That code was already used.";
    case "pass_expired": return "That code has expired — ask them to tap “use my credit” again.";
    case "no_balance": return "No credit left to redeem.";
    case "below_minimum": return "That bill is below the minimum purchase for redeeming credit.";
    default: return "Couldn't confirm this redemption.";
  }
}

// ── Owner: redemption guardrails (store-wide) ────────────────────────────────
export type RedemptionRules = { minBillUsd: number; maxRedeemUsd: number; exclusionNote: string };

/** Read the store's redemption guardrails, plus whether the caller may edit them. */
export async function getRedemptionRules(): Promise<{ rules: RedemptionRules; isOwner: boolean }> {
  const empty: RedemptionRules = { minBillUsd: 0, maxRedeemUsd: 0, exclusionNote: "" };
  const ctx = await getActiveStore();
  if (!ctx?.active) return { rules: empty, isOwner: false };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  const admin = createAdminClient();
  const { data } = await admin.from("stores").select("redemption_rules").eq("id", ctx.active.id).maybeSingle();
  const r = (data?.redemption_rules ?? {}) as { min_bill_cents?: number; max_redeem_cents?: number; exclusion_note?: string };
  return {
    rules: {
      minBillUsd: (r.min_bill_cents ?? 0) / 100,
      maxRedeemUsd: (r.max_redeem_cents ?? 0) / 100,
      exclusionNote: r.exclusion_note ?? "",
    },
    isOwner: !!isOwner || !!ctx.isPlatformAdmin,
  };
}

export async function saveRedemptionRules(input: RedemptionRules): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner && !ctx.isPlatformAdmin) return { ok: false, error: "Only owners can change redemption rules." };
  const admin = createAdminClient();
  const rules = {
    min_bill_cents: Math.max(0, Math.round((input.minBillUsd || 0) * 100)),
    max_redeem_cents: Math.max(0, Math.round((input.maxRedeemUsd || 0) * 100)),
    exclusion_note: (input.exclusionNote || "").trim().slice(0, 200),
  };
  const { error } = await admin.from("stores").update({ redemption_rules: rules }).eq("id", ctx.active.id);
  if (error) return { ok: false, error: "Couldn't save the rules." };
  revalidatePath("/redemptions");
  return { ok: true };
}
