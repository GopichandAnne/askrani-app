// Generic direct-HTTP tool runtime — runs the tools the builder brain generates
// from an API spec (http_tool rows). One executor covers any REST call: it maps
// the model's args onto path/query/body, applies auth (an encrypted API key or a
// broker OAuth token), calls the endpoint, and hands the trimmed JSON back.
//
// The model NEVER sees the key — it only fills the tool's declared params.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import type { FunctionDeclaration } from "./tools.ts";
import { decrypt, getAccessToken, type ProviderId } from "./connections.ts";

export interface HttpTool {
  id: string;
  name: string;
  description: string;
  method: string;
  base_url: string;
  path: string;
  // deno-lint-ignore no-explicit-any
  params: any;
  request_map: { param: string; in: "path" | "query" | "body" }[];
  // "identity" = forward the signed-in visitor's OWN identity (delegated identity)
  // instead of a store credential. `claim` picks what to send: the raw verified
  // token (default — for the host's own API to verify), or a verified email/phone/id.
  auth: {
    type: "none" | "apikey" | "oauth" | "identity";
    location?: "header" | "query";
    name?: string;
    prefix?: string;
    provider?: string;
    claim?: "token" | "email" | "phone" | "sub";
  };
  api_key: string | null;
  side_effect: boolean;
  timeout_ms: number;
  // Preventive governance: 'hold' blocks a write from executing (owner-set).
  action_policy?: "auto" | "hold";
}

/** The verified, signed-in visitor (from the embed's data-user-token). Never set
 *  by the model — only ever populated from a server-verified identity token. */
export interface Visitor {
  token?: string; // the raw verified identity token, to forward to the host's own API
  email?: string | null;
  phone?: string | null;
  sub?: string | null; // external user id, if the token carried one
}

const MAX_RESULT = 6000;

export async function loadHttpTools(db: SupabaseClient, storeId: string): Promise<HttpTool[]> {
  const { data, error } = await db
    .from("http_tool")
    .select("id, name, description, method, base_url, path, params, request_map, auth, api_key, side_effect, timeout_ms, action_policy")
    .eq("store_id", storeId).eq("enabled", true);
  if (error) { console.error(`[httptool] load: ${error.message}`); return []; }
  return (data ?? []) as HttpTool[];
}

export function httpToolDeclaration(t: HttpTool): FunctionDeclaration {
  const desc = t.side_effect
    ? `${t.description} (This performs an action — only call it AFTER the customer has clearly confirmed.)`
    : t.description;
  return { name: t.name, description: desc, parameters: t.params ?? { type: "object", properties: {}, required: [] } };
}

/** Run one generated tool. Never throws — a failure returns a soft note. */
export async function executeHttpTool(
  db: SupabaseClient, store: Store, t: HttpTool, args: Record<string, unknown>, visitor?: Visitor,
): Promise<Record<string, unknown>> {
  // Preventive governance: a write held by the owner never executes — flagged
  // for a person instead. Enforced here, so the model can't override it.
  if (t.side_effect && t.action_policy === "hold") {
    return { held: true, note: "That needs a team member to approve — I've flagged it for them and someone will follow up." };
  }
  try {
    let path = t.path;
    const query = new URLSearchParams();
    let body: Record<string, unknown> | null = null;
    for (const m of (t.request_map ?? [])) {
      const v = args[m.param];
      if (v === undefined || v === null || v === "") continue;
      if (m.in === "path") path = path.replace(`{${m.param}}`, encodeURIComponent(String(v)));
      else if (m.in === "query") query.set(m.param, String(v));
      else (body ??= {})[m.param] = v;
    }

    const headers: Record<string, string> = { accept: "application/json" };
    const auth = t.auth ?? { type: "none" };
    if (auth.type === "apikey" && t.api_key) {
      const key = await decrypt(t.api_key);
      if (auth.location === "query" && auth.name) query.set(auth.name, key);
      else headers[auth.name || "Authorization"] = `${auth.prefix ?? ""}${key}`;
    } else if (auth.type === "oauth" && auth.provider) {
      const token = await getAccessToken(db, store.id, auth.provider as ProviderId);
      if (!token) return { ok: false, note: `${auth.provider} isn't connected — offer to check with the store` };
      headers["Authorization"] = `Bearer ${token}`;
    } else if (auth.type === "identity") {
      // Delegated identity: call AS the signed-in visitor. The value comes only
      // from the server-verified identity token (never the model). Absent it (no
      // sign-in, or on WhatsApp), degrade to a soft note instead of calling.
      const claim = auth.claim ?? "token";
      const value = claim === "email" ? visitor?.email
        : claim === "phone" ? visitor?.phone
        : claim === "sub" ? visitor?.sub
        : visitor?.token;
      if (!value) return { ok: false, note: "I can't tell who you're signed in as here — this needs you to be logged in on the site." };
      if (auth.location === "query" && auth.name) query.set(auth.name, String(value));
      else headers[auth.name || "Authorization"] = `${auth.prefix ?? "Bearer "}${value}`;
    }

    let url = t.base_url.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path}`);
    const qs = query.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;

    const method = (t.method || "GET").toUpperCase();
    const init: RequestInit = { method, headers };
    if (body && method !== "GET" && method !== "HEAD") {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), t.timeout_ms ?? 6000);
    init.signal = ctrl.signal;
    try {
      const res = await fetch(url, init);
      const text = (await res.text()).slice(0, MAX_RESULT);
      if (!res.ok) {
        console.error(`[httptool] ${t.name} -> HTTP ${res.status}`);
        return { ok: false, note: "the service returned an error — offer to check with the store" };
      }
      let data: unknown = text;
      try { data = JSON.parse(text); } catch { /* keep as text */ }
      return { ok: true, result: data };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    console.error(`[httptool] ${t.name} ${aborted ? "timeout" : "error"}: ${e instanceof Error ? e.message : e}`);
    return { ok: false, note: aborted ? "the service didn't respond in time — offer to check with the store" : "couldn't reach the service — offer to check with the store" };
  }
}
