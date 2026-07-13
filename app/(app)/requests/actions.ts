"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";

export type RequestStatus = "new" | "reviewed" | "contacted" | "closed";

export type RequestField = { key: string; label?: string; required?: boolean };

export type RequestType = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  fields: RequestField[];
  enabled: boolean;
  accepts_upload: boolean;
  upload_types: string[];
  parse_with: string | null;
};

export type CapturedRequest = {
  id: string;
  type: string;
  fields: Record<string, unknown>;
  contact_email: string | null;
  contact_phone: string | null;
  status: RequestStatus;
  created_at: string;
};

export type Result = { ok: true } | { ok: false; error: string };

async function requireOwner(): Promise<
  { ok: true; slug: string; actor: string | null } | { ok: false; error: string }
> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can manage requests." };
  const { data: { user } } = await supabase.auth.getUser();
  return { ok: true, slug: ctx.active.slug, actor: user?.email ?? null };
}

// ── Captured requests (the inbox) ────────────────────────────────────────────
export async function listRequests(): Promise<CapturedRequest[]> {
  const gate = await requireOwner();
  if (!gate.ok) return [];
  const res = await callBotAdmin({ action: "list_requests", store_slug: gate.slug });
  if (!res.ok) return [];
  return (res.data.requests as CapturedRequest[]) ?? [];
}

export async function setRequestStatus(id: string, status: RequestStatus): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({ action: "set_request_status", store_slug: gate.slug, id, status });
  if (!res.ok) return res;
  revalidatePath("/requests");
  return { ok: true };
}

// ── Request-type definitions (what the assistant can capture) ─────────────────
export async function listRequestTypes(): Promise<RequestType[]> {
  const gate = await requireOwner();
  if (!gate.ok) return [];
  const res = await callBotAdmin({ action: "list_request_types", store_slug: gate.slug });
  if (!res.ok) return [];
  return (res.data.request_types as RequestType[]) ?? [];
}

export async function saveRequestType(input: {
  key: string;
  label: string;
  description?: string;
  fields: RequestField[];
  enabled?: boolean;
  accepts_upload?: boolean;
  upload_types?: string[];
  parse_with?: string | null;
}): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) {
    return { ok: false, error: "Key must be lowercase letters/numbers/underscores (e.g. career_interest)." };
  }
  if (!input.label.trim()) return { ok: false, error: "A label is required." };
  const res = await callBotAdmin({
    action: "set_request_type",
    store_slug: gate.slug,
    key,
    label: input.label.trim(),
    description: input.description?.trim() || null,
    fields: input.fields,
    enabled: input.enabled ?? true,
    accepts_upload: input.accepts_upload ?? false,
    upload_types: input.upload_types ?? [],
    parse_with: input.parse_with?.trim() || null,
    actor: gate.actor,
  });
  if (!res.ok) return res;
  revalidatePath("/requests");
  return { ok: true };
}

export async function deleteRequestType(key: string): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({ action: "delete_request_type", store_slug: gate.slug, key, actor: gate.actor });
  if (!res.ok) return res;
  revalidatePath("/requests");
  return { ok: true };
}

// ── Natural-language config (the LLM proposes; the owner confirms; we apply) ───
export type ConfigAction = {
  kind: "upsert_type" | "delete_type" | "subscribe" | "unsubscribe";
  key?: string;
  label?: string;
  description?: string;
  fields?: RequestField[];
  topic?: string;
  responder_email?: string;
  responder_phone?: string;
  responder_name?: string;
};
export type ConfigPlan = { summary: string; actions: ConfigAction[] };

export async function planConfig(
  instruction: string,
): Promise<{ ok: true; plan: ConfigPlan } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({ action: "plan_request_config", store_slug: gate.slug, instruction });
  if (!res.ok) return res;
  return { ok: true, plan: res.data.plan as ConfigPlan };
}

export async function applyConfig(
  actions: ConfigAction[],
  meta?: { summary?: string; instruction?: string },
): Promise<{ ok: true; applied: string[]; skipped: string[] } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({
    action: "apply_request_config",
    store_slug: gate.slug,
    actions,
    summary: meta?.summary,
    instruction: meta?.instruction,
    actor: gate.actor,
  });
  if (!res.ok) return res;
  revalidatePath("/requests");
  return {
    ok: true,
    applied: (res.data.applied as string[]) ?? [],
    skipped: (res.data.skipped as string[]) ?? [],
  };
}

// ── Config audit log ─────────────────────────────────────────────────────────
export type ConfigAuditEntry = {
  id: string;
  actor: string | null;
  source: "nl" | "manual";
  summary: string;
  details: { instruction?: string | null; applied?: string[]; skipped?: string[] };
  created_at: string;
};

export async function listConfigAudit(): Promise<ConfigAuditEntry[]> {
  const gate = await requireOwner();
  if (!gate.ok) return [];
  const res = await callBotAdmin({ action: "list_config_audit", store_slug: gate.slug });
  if (!res.ok) return [];
  return (res.data.audit as ConfigAuditEntry[]) ?? [];
}
