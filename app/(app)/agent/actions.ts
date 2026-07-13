"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";
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

    // Guard settings that are easy to mis-enter. Tax rate is a FRACTION
    // (0.0825 = 8.25%); a store once saved "8.25" → 825% tax on every order.
    if (key === "tax_rate" && value.trim() !== "") {
      const rate = Number(value);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        return {
          ok: false,
          error: "Tax rate must be a decimal between 0 and 1 — e.g. 0.0825 for 8.25%. (Not 8.25.)",
        };
      }
    }
    if ((key === "followup_minutes" || key === "history_turns") && value.trim() !== "") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `${key.replace("_", " ")} must be a positive number.` };
      }
    }

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

// ── Charges & fees (tax, delivery, service…) ──────────────────────────────────
export type Charge = {
  id?: string;
  label: string;
  kind: "percent" | "flat";
  value: number;
  applies_to: "all" | "pickup" | "delivery";
  enabled: boolean;
};

async function ownerSlug(): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return { ok: false, error: "Only owners can manage charges." };
  return { ok: true, slug: ctx.active.slug };
}

export async function listCharges(): Promise<Charge[]> {
  const gate = await ownerSlug();
  if (!gate.ok) return [];
  const res = await callBotAdmin({ action: "list_charges", store_slug: gate.slug });
  if (!res.ok) return [];
  return (res.data.charges as Charge[]) ?? [];
}

export async function saveCharge(input: Charge): Promise<SaveResult> {
  const gate = await ownerSlug();
  if (!gate.ok) return gate;
  if (!input.label.trim()) return { ok: false, error: "Give the charge a name." };
  if (!Number.isFinite(input.value) || input.value < 0) return { ok: false, error: "Value must be a number ≥ 0." };
  const res = await callBotAdmin({ action: "set_charge", store_slug: gate.slug, ...input });
  if (!res.ok) return res;
  revalidatePath("/agent");
  revalidatePath("/orders");
  return { ok: true };
}

export async function deleteCharge(id: string): Promise<SaveResult> {
  const gate = await ownerSlug();
  if (!gate.ok) return gate;
  const res = await callBotAdmin({ action: "delete_charge", store_slug: gate.slug, id });
  if (!res.ok) return res;
  revalidatePath("/agent");
  revalidatePath("/orders");
  return { ok: true };
}
