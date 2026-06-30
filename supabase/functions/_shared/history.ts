// Load prior conversation turns for a session — Bot Phase 2.
// Reads the analytics turn log (conversations), newest-first capped at the
// store's history_turns, then reverses to oldest-first and shapes into Gemini
// contents. The CURRENT inbound is not here yet (it's logged after the reply),
// so this returns strictly prior context.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Content, shapeHistory } from "./prompt.ts";

export async function loadHistory(
  db: SupabaseClient,
  storeSlug: string,
  sessionId: string,
  limit: number,
): Promise<Content[]> {
  const { data, error } = await db
    .from("conversations")
    .select("user_message, assistant_response, created_at")
    .eq("store_slug", storeSlug)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[history] load ${sessionId}: ${error.message}`);
    return [];
  }
  // newest-first -> oldest-first for chronological context
  const rows = (data ?? []).slice().reverse();
  return shapeHistory(rows);
}
