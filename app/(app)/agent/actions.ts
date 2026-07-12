"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStore } from "@/lib/store/active-store";
import type { Database } from "@/lib/database.types";

type AgentKey = Database["public"]["Enums"]["agent_config_key"];

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Keys the Agent Setup screen may write. */
const EDITABLE: AgentKey[] = [
  "personality",
  "store_prompt",
  "language_handling",
  "engage_info",
  "off_topic_handling",
  "promotions",
  "order_prompt",
  "order_item_details",
  "orders_enabled",
  "catalog_enabled",
  "followup_enabled",
  "followup_minutes",
  "tax_rate",
  "history_turns",
];

/**
 * Save one or more agent_config values for the active store (owners only).
 * Each key upserts agent_config (RLS also enforces owner) with a bumped version,
 * and appends an agent_config_history row (service role — clients can't write
 * history) for revertability.
 */
export async function saveAgentConfig(
  fields: Record<string, string>,
): Promise<SaveResult> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", {
    p_store_id: ctx.active.id,
  });
  if (!isOwner) return { ok: false, error: "Only owners can edit the agent." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createAdminClient();
  const editable = new Set<string>(EDITABLE);

  for (const [key, raw] of Object.entries(fields)) {
    if (!editable.has(key)) continue;
    const value = (raw ?? "").toString();

    const { data: cur } = await supabase
      .from("agent_config")
      .select("version")
      .eq("store_id", ctx.active.id)
      .eq("key", key as AgentKey)
      .maybeSingle();
    const version = (cur?.version ?? 0) + 1;

    const { data: up, error } = await supabase
      .from("agent_config")
      .upsert(
        { store_id: ctx.active.id, key: key as AgentKey, value, version, updated_by: user?.id ?? null },
        { onConflict: "store_id,key" },
      )
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };

    await admin.from("agent_config_history").insert({
      config_id: up.id,
      store_id: ctx.active.id,
      key: key as AgentKey,
      value,
      version,
      updated_by: user?.id ?? null,
    });
  }

  revalidatePath("/agent");
  return { ok: true };
}

// ── Escalation responders ─────────────────────────────────────────────────────
export type Responder = Database["public"]["Tables"]["store_responders"]["Row"];
export type ResponderResult =
  | { ok: true; responder: Responder }
  | { ok: false; error: string };

/** Normalize a phone to digits only (E.164 without '+', matching WhatsApp 'from'). */
function normalizePhone(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}

export async function listResponders(): Promise<Responder[]> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("store_responders")
    .select("*")
    .eq("store_slug", ctx.active.slug)
    .order("created_at", { ascending: true });
  return (data ?? []) as Responder[];
}

export async function addResponder(input: {
  phone?: string;
  email?: string;
  name?: string;
  role?: "owner" | "staff";
  topics?: string[];
}): Promise<ResponderResult> {
  const phone = normalizePhone(input.phone ?? "");
  const email = (input.email ?? "").trim().toLowerCase();
  if (!phone && !email) return { ok: false, error: "Add a WhatsApp number or an email." };
  if (phone && phone.length < 7) {
    return { ok: false, error: "Enter a valid phone number (country code + number)." };
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can manage responders." };

  const { data, error } = await supabase
    .from("store_responders")
    .upsert(
      {
        store_slug: ctx.active.slug,
        phone: phone || null,
        email: email || null,
        name: (input.name ?? "").trim() || null,
        role: input.role ?? "staff",
        topics: input.topics ?? ["escalation"],
        active: true,
      },
      { onConflict: "store_slug,phone" },
    )
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/agent");
  return { ok: true, responder: data as Responder };
}

export async function updateResponder(
  id: string,
  patch: Partial<Pick<Responder, "active" | "topics">>,
): Promise<ResponderResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_responders")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Responder not found (owners only)." };
  revalidatePath("/agent");
  return { ok: true, responder: data as Responder };
}

export async function removeResponder(id: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("store_responders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/agent");
  return { ok: true };
}
