// Per-store custom integrations (connectors) — Bot Phase 6.
//
// The bot core is a generic function-calling kernel; this module lets a store
// plug in extra tools (POS price lookups, stock checks, etc.) WITHOUT any core
// change. Each enabled row in store_integrations becomes a tool the model can
// call; execution POSTs the args to the store's own endpoint (HMAC-signed, with
// a timeout) and hands the JSON straight back to the model. The integration
// logic lives outside this platform — we never import a POS/payment SDK.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";

export interface StoreIntegration {
  id: string;
  name: string;
  description: string;
  // deno-lint-ignore no-explicit-any
  params_schema: any;
  kind: string;
  endpoint_url: string;
  auth_secret: string | null;
  side_effect: boolean;
  timeout_ms: number;
}

const MAX_RESULT_CHARS = 8000; // cap what a connector can feed back to the model

/** Load a store's enabled connectors. Empty for stores with none → no-op. */
export async function loadStoreIntegrations(
  db: SupabaseClient,
  storeId: string,
): Promise<StoreIntegration[]> {
  const { data, error } = await db
    .from("store_integrations")
    .select("id, name, description, params_schema, kind, endpoint_url, auth_secret, side_effect, timeout_ms")
    .eq("store_id", storeId)
    .eq("enabled", true);
  if (error) {
    console.error(`[integrations] load: ${error.message}`);
    return [];
  }
  return (data ?? []) as StoreIntegration[];
}

/** A Gemini FunctionDeclaration for a connector (its stored JSON Schema is the
 *  parameter spec). side_effect tools get an explicit "confirm first" note. */
export function integrationDeclaration(integ: StoreIntegration): {
  name: string;
  description: string;
  // deno-lint-ignore no-explicit-any
  parameters: any;
} {
  const desc = integ.side_effect
    ? `${integ.description} (This performs an action — only call it AFTER the customer has clearly confirmed.)`
    : integ.description;
  return {
    name: integ.name,
    description: desc,
    parameters: integ.params_schema ?? { type: "object", properties: {}, required: [] },
  };
}

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Call a connector for one tool invocation. Never throws — a failure returns a
 *  soft note so the bot degrades to "I'll check with the store" instead of hanging. */
export async function executeIntegration(
  integ: StoreIntegration,
  store: Store,
  sessionId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload = JSON.stringify({
    store_slug: store.slug,
    tool: integ.name,
    args,
    session_id: sessionId,
    ts: new Date().toISOString(),
  });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (integ.auth_secret) headers["X-Rani-Signature"] = await sign(integ.auth_secret, payload);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), integ.timeout_ms ?? 4000);
  try {
    const res = await fetch(integ.endpoint_url, {
      method: "POST",
      headers,
      body: payload,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(`[integrations] ${integ.name} -> HTTP ${res.status}`);
      return { ok: false, note: "the lookup service is unavailable right now — offer to check with the store" };
    }
    const text = (await res.text()).slice(0, MAX_RESULT_CHARS);
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, note: "the service returned something unreadable — offer to check with the store" };
    }
    return { ok: true, result: data };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    console.error(`[integrations] ${integ.name} ${aborted ? "timeout" : "error"}: ${e instanceof Error ? e.message : e}`);
    return { ok: false, note: "the lookup didn't respond in time — offer to check with the store" };
  } finally {
    clearTimeout(timer);
  }
}
