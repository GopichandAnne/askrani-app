"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";

// Post-for-credit review queue. Any staff (owner / staff / redemption) may review.
// Reads the submissions via the admin client (service-role table), and approves/
// rejects through bot-admin (which runs the verified accrual logic).

export type PendingSubmission = {
  id: string;
  memberName: string | null;
  platform: string | null;
  format: string | null;
  postUrl: string;
  banded: boolean; // reach-based -> reviewer enters the reach
  createdAt: string;
};
type Result = { ok: true; amountUsd?: number } | { ok: false; error: string };

async function requireStaff(): Promise<
  { ok: true; slug: string; storeId: string; staffId: string | null } | { ok: false; error: string }
> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: staff } = await supabase
    .from("staff").select("id").eq("store_id", ctx.active.id).eq("user_id", user?.id ?? "").maybeSingle();
  return { ok: true, slug: ctx.active.slug, storeId: ctx.active.id, staffId: staff?.id ?? null };
}

export async function loadSubmissions(): Promise<PendingSubmission[]> {
  const gate = await requireStaff();
  if (!gate.ok) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("social_submissions")
    .select("id, platform, format, post_url, created_at, member_id, rule_id")
    .eq("store_id", gate.storeId)
    .eq("status", "submitted")
    .order("created_at", { ascending: true });
  const subs = (data ?? []) as unknown as {
    id: string; platform: string | null; format: string | null; post_url: string;
    created_at: string; member_id: string; rule_id: string | null;
  }[];
  if (!subs.length) return [];

  const memberIds = [...new Set(subs.map((s) => s.member_id))];
  const { data: members } = await admin.from("store_members").select("id, display_name").in("id", memberIds);
  const nameById = new Map((members ?? []).map((m) => [m.id as string, m.display_name as string | null]));

  const ruleIds = [...new Set(subs.map((s) => s.rule_id).filter(Boolean))] as string[];
  const bandedById = new Map<string, boolean>();
  if (ruleIds.length) {
    const { data: rules } = await admin.from("reward_rules").select("id, amount_model").in("id", ruleIds);
    for (const r of rules ?? []) bandedById.set(r.id as string, (r.amount_model as string) === "tier");
  }

  return subs.map((s) => ({
    id: s.id,
    memberName: nameById.get(s.member_id) ?? null,
    platform: s.platform,
    format: s.format,
    postUrl: s.post_url,
    banded: s.rule_id ? !!bandedById.get(s.rule_id) : false,
    createdAt: s.created_at,
  }));
}

export async function reviewSubmission(
  submissionId: string,
  decision: "approve" | "reject",
  reach?: number,
  note?: string,
): Promise<Result> {
  const gate = await requireStaff();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({
    action: "review_submission",
    store_slug: gate.slug,
    submission_id: submissionId,
    decision,
    reach: reach ?? null,
    note: note ?? null,
    staff_id: gate.staffId,
  });
  if (!res.ok) return { ok: false, error: res.error };
  if (res.data.ok === false) {
    return { ok: false, error: String(res.data.error ?? "Couldn't record the decision.") };
  }
  revalidatePath("/reviews");
  const cents = res.data.amount_cents;
  return { ok: true, amountUsd: cents != null ? Number(cents) / 100 : undefined };
}
