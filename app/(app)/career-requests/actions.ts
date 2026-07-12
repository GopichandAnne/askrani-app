"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";

export type CareerRequestStatus = "new" | "reviewed" | "contacted" | "closed";

export type CareerRequest = {
  id: string;
  email: string;
  positions: string | null;
  skills: string | null;
  notes: string | null;
  status: CareerRequestStatus;
  created_at: string;
};

export type Result = { ok: true } | { ok: false; error: string };

async function requireOwner(): Promise<
  { ok: true; slug: string } | { ok: false; error: string }
> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can view career requests." };
  return { ok: true, slug: ctx.active.slug };
}

export async function listCareerRequests(): Promise<CareerRequest[]> {
  const gate = await requireOwner();
  if (!gate.ok) return [];
  const res = await callBotAdmin({ action: "list_career_requests", store_slug: gate.slug });
  if (!res.ok) return [];
  return (res.data.career_requests as CareerRequest[]) ?? [];
}

export async function setCareerRequestStatus(
  id: string,
  status: CareerRequestStatus,
): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({
    action: "set_career_request_status",
    store_slug: gate.slug,
    id,
    status,
  });
  if (!res.ok) return res;
  revalidatePath("/career-requests");
  return { ok: true };
}
