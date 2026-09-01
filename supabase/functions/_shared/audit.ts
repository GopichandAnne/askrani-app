// Trust surface — record what the agent did through a tool, and as whom.
// Best-effort: a logging failure must NEVER break the chat. No credentials or raw
// args are ever written; for delegated-identity calls we store a human label for
// the signed-in customer (email/id), never the token.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import type { Visitor } from "./httptool.ts";

/** Who a call acted as: the signed-in customer when a tool forwards identity,
 *  otherwise null (it acted as the store's own credential / no auth). */
export function actedAsLabel(authType: string | undefined, visitor?: Visitor): string | null {
  if (authType !== "identity") return null;
  return visitor?.email || visitor?.sub || visitor?.phone || "signed-in customer";
}

export async function logToolCall(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  e: { tool: string; kind: "http" | "mcp" | "connector"; actedAs: string | null; sideEffect: boolean; status: "ok" | "error" | "held" },
): Promise<void> {
  try {
    await db.from("agent_action_log").insert({
      store_id: store.id,
      session_id: sessionId,
      tool: e.tool.slice(0, 80),
      kind: e.kind,
      acted_as: e.actedAs ? e.actedAs.slice(0, 160) : null,
      side_effect: e.sideEffect,
      status: e.status,
    });
  } catch {
    /* best-effort — never break the chat for an audit write */
  }
}
