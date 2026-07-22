"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";

// Post-for-credit review queue. Any staff (owner / staff / redemption) may review.
// Reads the submissions via the admin client (service-role table), and approves/
// rejects through bot-admin (which runs the verified accrual logic).

export type FormatOption = { key: string; usd: number };
export type PendingSubmission = {
  id: string;
  memberName: string | null;
  platform: string | null;
  format: string | null;
  postUrl: string;
  pricing: "flat" | "tier" | "format"; // tier -> reviewer enters reach; format -> reviewer picks format
  formats: FormatOption[];             // priced formats (pricing === 'format')
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
  const ruleById = new Map<string, { model: string; formats: FormatOption[] }>();
  if (ruleIds.length) {
    const { data: rules } = await admin.from("reward_rules").select("id, amount_model, format_amounts").in("id", ruleIds);
    for (const r of rules ?? []) {
      const fa = (r.format_amounts ?? {}) as Record<string, number>;
      const formats: FormatOption[] = ["reel", "post", "story"]
        .filter((k) => Number(fa[k] ?? 0) > 0)
        .map((k) => ({ key: k, usd: Number(fa[k]) / 100 }));
      ruleById.set(r.id as string, { model: r.amount_model as string, formats });
    }
  }

  return subs.map((s) => {
    const rule = s.rule_id ? ruleById.get(s.rule_id) : undefined;
    const pricing = rule?.model === "tier" ? "tier" : rule?.model === "format" ? "format" : "flat";
    return {
      id: s.id,
      memberName: nameById.get(s.member_id) ?? null,
      platform: s.platform,
      format: s.format,
      postUrl: s.post_url,
      pricing: pricing as PendingSubmission["pricing"],
      formats: rule?.formats ?? [],
      createdAt: s.created_at,
    };
  });
}

export async function reviewSubmission(
  submissionId: string,
  decision: "approve" | "reject",
  opts: { reach?: number; format?: string; note?: string } = {},
): Promise<Result> {
  const gate = await requireStaff();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({
    action: "review_submission",
    store_slug: gate.slug,
    submission_id: submissionId,
    decision,
    reach: opts.reach ?? null,
    format: opts.format ?? null,
    note: opts.note ?? null,
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
