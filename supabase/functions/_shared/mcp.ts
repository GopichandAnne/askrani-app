// MCP runtime — lets Rani call remote (Streamable-HTTP) MCP servers as tools.
// An owner connects a server; we discover its tools (tools/list) and register
// them; at chat time the model picks one by context and we proxy the call
// (tools/call). Store-level auth only, reusing the vault (encrypted api key) and
// the OAuth broker (getAccessToken). The model NEVER sees the credential.
//
// Transport: JSON-RPC 2.0 over a single HTTP endpoint. The server may reply with
// application/json OR a text/event-stream (SSE); we handle both, and carry the
// Mcp-Session-Id header the server hands back at initialize.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import type { FunctionDeclaration } from "./tools.ts";
import { decrypt, getAccessToken, type ProviderId } from "./connections.ts";
import type { Visitor } from "./httptool.ts";

const PROTOCOL_VERSION = "2025-06-18";
const MAX_RESULT = 6000;
const REQ_TIMEOUT_MS = 12_000;

export interface McpServer {
  id: string;
  store_id: string;
  name: string;
  url: string;
  // "identity" = forward the signed-in customer's OWN verified identity (delegated
  // identity) as an HTTP header, so the MCP server acts as that user. `claim`
  // picks what to send: the raw verified token (default), or a verified email/phone/id.
  auth: {
    type: "none" | "apikey" | "oauth" | "identity";
    name?: string;
    prefix?: string;
    provider?: string;
    claim?: "token" | "email" | "phone" | "sub";
  };
  api_key: string | null;
  enabled: boolean;
}

export interface McpTool {
  id: string;
  name: string;
  remote_name: string;
  description: string;
  // deno-lint-ignore no-explicit-any
  input_schema: any;
  side_effect: boolean;
  server: McpServer;
}

// deno-lint-ignore no-explicit-any
type Any = any;

/** Store-level auth headers for a server — encrypted key from the vault, or a
 *  broker OAuth token. Never derived from model input. */
async function authHeaders(db: SupabaseClient, storeId: string, s: McpServer, visitor?: Visitor): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  try {
    if (s.auth?.type === "apikey" && s.api_key) {
      const key = await decrypt(s.api_key);
      h[s.auth.name || "Authorization"] = `${s.auth.prefix ?? "Bearer "}${key}`;
    } else if (s.auth?.type === "oauth" && s.auth.provider) {
      const token = await getAccessToken(db, storeId, s.auth.provider as ProviderId);
      if (token) h["Authorization"] = `Bearer ${token}`;
    } else if (s.auth?.type === "identity") {
      // Delegated identity: call AS the signed-in visitor. The value comes only
      // from the server-verified identity token (never the model). Absent (no
      // sign-in / WhatsApp), we add nothing — executeMcpTool guards the call.
      const v = identityValue(s, visitor);
      if (v) h[s.auth.name || "Authorization"] = `${s.auth.prefix ?? "Bearer "}${v}`;
    }
  } catch (e) {
    console.error(`[mcp] auth header build failed: ${e instanceof Error ? e.message : e}`);
  }
  return h;
}

/** The verified identity value this server forwards (token/email/phone/sub), or "". */
function identityValue(s: McpServer, visitor?: Visitor): string {
  const claim = s.auth?.claim ?? "token";
  const v = claim === "email" ? visitor?.email
    : claim === "phone" ? visitor?.phone
    : claim === "sub" ? visitor?.sub
    : visitor?.token;
  return v ? String(v) : "";
}

/** POST one JSON-RPC message; parse a JSON or SSE reply into the matching result. */
async function post(
  url: string,
  headers: Record<string, string>,
  payload: Any,
): Promise<{ message: Any | null; sessionId: string | null; status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const sessionId = res.headers.get("mcp-session-id");
    // Notifications (no id) get a 202 with no body.
    if (res.status === 202 || res.status === 204) return { message: null, sessionId, status: res.status };
    const ctype = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (ctype.includes("text/event-stream")) {
      // Collect `data:` lines; return the first JSON-RPC object carrying a result/error.
      let found: Any = null;
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^data:\s?(.*)$/);
        if (!m) continue;
        try {
          const obj = JSON.parse(m[1]);
          if (obj && (obj.result !== undefined || obj.error !== undefined)) { found = obj; break; }
        } catch { /* partial/keepalive line */ }
      }
      return { message: found, sessionId, status: res.status };
    }
    try { return { message: text ? JSON.parse(text) : null, sessionId, status: res.status }; }
    catch { return { message: null, sessionId, status: res.status }; }
  } finally {
    clearTimeout(t);
  }
}

/** Handshake: initialize (+ capture session) then the initialized notification.
 *  Returns the headers to use for subsequent calls (incl. the session id). */
async function openSession(
  db: SupabaseClient, storeId: string, s: McpServer, visitor?: Visitor,
): Promise<{ ok: boolean; headers: Record<string, string>; error?: string }> {
  const base: Record<string, string> = {
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    ...(await authHeaders(db, storeId, s, visitor)),
  };
  const init = await post(s.url, base, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "AskRani", version: "1.0" },
    },
  });
  if (!init.message || init.message.error) {
    return { ok: false, headers: base, error: init.message?.error?.message ?? `initialize failed (HTTP ${init.status})` };
  }
  const headers = { ...base };
  if (init.sessionId) headers["Mcp-Session-Id"] = init.sessionId;
  // Fire-and-forget the initialized notification (some servers require it).
  try { await post(s.url, headers, { jsonrpc: "2.0", method: "notifications/initialized" }); } catch { /* non-fatal */ }
  return { ok: true, headers };
}

/** Discover a server's tools. Used by the `mcp` function at connect/refresh. */
export async function mcpListTools(
  db: SupabaseClient, storeId: string, s: McpServer,
): Promise<{ ok: true; tools: { name: string; description: string; inputSchema: Any }[] } | { ok: false; error: string }> {
  const sess = await openSession(db, storeId, s);
  if (!sess.ok) return { ok: false, error: sess.error ?? "couldn't connect" };
  const res = await post(s.url, sess.headers, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  if (!res.message || res.message.error) return { ok: false, error: res.message?.error?.message ?? "tools/list failed" };
  const tools = Array.isArray(res.message.result?.tools) ? res.message.result.tools : [];
  return {
    ok: true,
    tools: tools.map((t: Any) => ({
      name: String(t?.name ?? ""),
      description: String(t?.description ?? ""),
      inputSchema: t?.inputSchema ?? { type: "object", properties: {} },
    })).filter((t: Any) => t.name),
  };
}

/** Load the enabled MCP tools (from enabled servers) for a store, for the toolset. */
export async function loadMcpTools(db: SupabaseClient, storeId: string): Promise<McpTool[]> {
  const { data, error } = await db
    .from("mcp_tool")
    .select("id, name, remote_name, description, input_schema, side_effect, enabled, mcp_server!inner(id, store_id, name, url, auth, api_key, enabled)")
    .eq("store_id", storeId)
    .eq("enabled", true)
    .eq("mcp_server.enabled", true);
  if (error) { console.error(`[mcp] load: ${error.message}`); return []; }
  return (data ?? []).map((r: Any) => ({
    id: r.id, name: r.name, remote_name: r.remote_name, description: r.description,
    input_schema: r.input_schema, side_effect: r.side_effect, server: r.mcp_server as McpServer,
  }));
}

export function mcpToolDeclaration(t: McpTool): FunctionDeclaration {
  const desc = t.side_effect
    ? `${t.description} (This performs an action — only call it AFTER the customer has clearly confirmed.)`
    : t.description;
  return { name: t.name, description: desc || t.remote_name, parameters: t.input_schema ?? { type: "object", properties: {}, required: [] } };
}

/** Extract readable text from an MCP tools/call result's content array. */
function contentText(result: Any): string {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const txt = parts
    .map((p: Any) => (p?.type === "text" ? String(p.text ?? "") : p?.type ? `[${p.type}]` : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  return txt || (result != null ? JSON.stringify(result).slice(0, MAX_RESULT) : "");
}

/** Run one MCP tool. Never throws — a failure returns a soft note. */
export async function executeMcpTool(
  db: SupabaseClient, store: Store, t: McpTool, args: Record<string, unknown>, visitor?: Visitor,
): Promise<Record<string, unknown>> {
  try {
    // Delegated-identity servers can only be called for a signed-in visitor.
    if (t.server.auth?.type === "identity" && !identityValue(t.server, visitor)) {
      return { error: "I can't tell who you're signed in as here — this needs you to be logged in on the site." };
    }
    const sess = await openSession(db, store.id, t.server, visitor);
    if (!sess.ok) return { error: `couldn't reach ${t.server.name}`, note: sess.error };
    const res = await post(t.server.url, sess.headers, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: t.remote_name, arguments: args ?? {} },
    });
    if (!res.message) return { error: "no response from the tool" };
    if (res.message.error) return { error: res.message.error.message ?? "the tool returned an error" };
    const r = res.message.result;
    const text = contentText(r).slice(0, MAX_RESULT);
    if (r?.isError) return { error: text || "the tool reported a failure" };
    return { result: text };
  } catch (e) {
    console.error(`[mcp] execute ${t.name}: ${e instanceof Error ? e.message : e}`);
    return { error: "the tool is temporarily unavailable" };
  }
}
