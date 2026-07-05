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
  "order_prompt",
  "orders_enabled",
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
