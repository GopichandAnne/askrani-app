// Load a store's conversation config (agent_config + saved_qa) — Bot Phase 2.
// Produces the AgentConfig that buildSystemInstruction() turns into the stable
// cacheable prefix. agent_config is the source of truth (Option B); editing it
// in the panel naturally rotates the implicit cache (the prefix changes).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AgentConfig } from "./prompt.ts";
import type { Store } from "./types.ts";

const DEFAULT_HISTORY_TURNS = 10;
const SAVED_QA_LIMIT = 50;

export async function loadAgentConfig(
  db: SupabaseClient,
  store: Store,
): Promise<AgentConfig> {
  const [cfg, qa] = await Promise.all([
    db.from("agent_config").select("key, value").eq("store_id", store.id),
    db
      .from("saved_qa")
      .select("question, answer")
      .eq("store_id", store.id)
      .eq("active", true)
      .order("times_used", { ascending: false })
      .limit(SAVED_QA_LIMIT),
  ]);

  const m = new Map<string, string | null>(
    (cfg.data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
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
    savedQa: (qa.data ?? []).map(
      (r: { question: string; answer: string | null }) => ({
        question: r.question,
        answer: r.answer,
      }),
    ),
  };
}
