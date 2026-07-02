// Load a store's conversation config (agent_config) — Bot Phase 2 (updated 3a).
// Produces the AgentConfig that buildSystemInstruction() turns into the stable
// cacheable prefix. agent_config is the source of truth (Option B); editing it
// in the panel naturally rotates the implicit cache (the prefix changes).
//
// saved_qa is NOT loaded here anymore — as of Phase 3a it's retrieved on demand
// via search_knowledge (Phase 3b) rather than injected into the prefix.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AgentConfig } from "./prompt.ts";
import type { Store } from "./types.ts";

const DEFAULT_HISTORY_TURNS = 10;

export async function loadAgentConfig(
  db: SupabaseClient,
  store: Store,
): Promise<AgentConfig> {
  const { data } = await db
    .from("agent_config")
    .select("key, value")
    .eq("store_id", store.id);

  const m = new Map<string, string | null>(
    (data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  );
  const turns = parseInt(m.get("history_turns") ?? "", 10);

  return {
    storeName: store.store_display_name ?? store.slug,
    businessType: store.business_type ?? null,
    personality: m.get("personality") ?? null,
    offTopicHandling: m.get("off_topic_handling") ?? null,
    languageHandling: m.get("language_handling") ?? null,
    engageInfo: m.get("engage_info") ?? null,
    storePrompt: m.get("store_prompt") ?? null,
    historyTurns: Number.isFinite(turns) && turns > 0 ? turns : DEFAULT_HISTORY_TURNS,
  };
}
