// mcp — connect & manage remote MCP servers for a store. The owner points Rani
// at an MCP server URL; we handshake + discover its tools (tools/list) and
// register them so Rani can call them by context at chat time (see _shared/mcp.ts).
// Owner-authed (verify_jwt ON). Store-level auth only: an API key is AES-GCM
// encrypted into the vault, or a broker OAuth provider is referenced — the model
// never sees a credential.

import { serviceClient } from "../_shared/supabase.ts";
import { encrypt, isProvider } from "../_shared/connections.ts";
import { mcpListTools, type McpServer } from "../_shared/mcp.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;

const WRITE_HINT = /(create|update|delete|remove|send|post|write|pay|book|cancel|charge|order|submit|schedule|email|set_)/i;

/** A model-safe, store-unique tool name from a server + its remote tool name. */
function toolName(serverName: string, remote: string): string {
  const s = serverName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const r = remote.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 40);
  return `mcp_${s}_${r}`.slice(0, 60);
}

async function serverRow(db: Any, storeId: string, serverId: string): Promise<McpServer | null> {
  const { data } = await db.from("mcp_server").select("id, store_id, name, url, auth, api_key, enabled").eq("store_id", storeId).eq("id", serverId).maybeSingle();
  return (data as McpServer) ?? null;
}

/** Discover + upsert tools for a server. Keeps existing tools' enabled state. */
async function syncTools(db: Any, storeId: string, s: McpServer): Promise<{ ok: boolean; tools: Any[]; error?: string }> {
  const res = await mcpListTools(db, storeId, s);
  if (!res.ok) return { ok: false, tools: [], error: res.error };
  const { data: existing } = await db.from("mcp_tool").select("remote_name, enabled").eq("server_id", s.id);
  const wasEnabled = new Map<string, boolean>((existing ?? []).map((e: Any) => [e.remote_name, e.enabled]));
  const rows = res.tools.map((t) => ({
    store_id: storeId,
    server_id: s.id,
    name: toolName(s.name, t.name),
    remote_name: t.name,
    description: t.description.slice(0, 400),
    input_schema: t.inputSchema ?? { type: "object", properties: {} },
    side_effect: WRITE_HINT.test(t.name),
    enabled: wasEnabled.get(t.name) ?? true,
  }));
  if (rows.length) {
    const { error } = await db.from("mcp_tool").upsert(rows, { onConflict: "server_id,remote_name" });
    if (error) return { ok: false, tools: [], error: error.message };
  }
  return { ok: true, tools: rows };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let userId = "";
  try {
    const seg = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").split(".")[1] ?? "";
    let s = seg.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    userId = JSON.parse(atob(s)).sub ?? "";
  } catch { /* ignore */ }
  if (!userId) return json({ error: "unauthorized" }, 401);

  let body: { action?: string; storeSlug?: string; name?: string; url?: string; authType?: string; apiKey?: string; authProvider?: string; identityClaim?: string; identityField?: string; serverId?: string; toolId?: string; enabled?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const slug = String(body.storeSlug ?? "").trim().toLowerCase();
  if (!slug) return json({ error: "storeSlug required" }, 400);

  const db: Any = serviceClient();
  const { data: store } = await db.from("stores").select("id, slug").eq("slug", slug).maybeSingle();
  if (!store) return json({ error: "unknown store" }, 404);
  const [staffRes, adminRes] = await Promise.all([
    db.from("staff").select("role").eq("store_id", store.id).eq("user_id", userId).eq("status", "active").maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (!(staffRes.data?.role === "owner" || adminRes.data)) return json({ error: "forbidden — owner only" }, 403);

  const action = String(body.action ?? "connect");

  if (action === "list") {
    const [{ data: servers }, { data: tools }] = await Promise.all([
      db.from("mcp_server").select("id, name, url, auth, enabled, created_at").eq("store_id", store.id).order("created_at", { ascending: false }),
      db.from("mcp_tool").select("id, server_id, name, remote_name, description, side_effect, enabled").eq("store_id", store.id).order("remote_name"),
    ]);
    return json({ servers: servers ?? [], tools: tools ?? [] });
  }

  if (action === "toggle_tool") {
    if (!body.toolId) return json({ error: "toolId required" }, 400);
    await db.from("mcp_tool").update({ enabled: body.enabled === true }).eq("store_id", store.id).eq("id", body.toolId);
    return json({ ok: true });
  }

  if (action === "toggle_server") {
    if (!body.serverId) return json({ error: "serverId required" }, 400);
    await db.from("mcp_server").update({ enabled: body.enabled === true }).eq("store_id", store.id).eq("id", body.serverId);
    return json({ ok: true });
  }

  if (action === "remove") {
    if (!body.serverId) return json({ error: "serverId required" }, 400);
    await db.from("mcp_server").delete().eq("store_id", store.id).eq("id", body.serverId);
    return json({ ok: true });
  }

  if (action === "refresh") {
    if (!body.serverId) return json({ error: "serverId required" }, 400);
    const s = await serverRow(db, store.id, body.serverId);
    if (!s) return json({ error: "unknown server" }, 404);
    const sync = await syncTools(db, store.id, s);
    if (!sync.ok) return json({ error: sync.error ?? "couldn't reach that server" }, 400);
    return json({ ok: true, tools: sync.tools });
  }

  // action === "connect"
  const name = String(body.name ?? "").trim().slice(0, 60);
  const url = String(body.url ?? "").trim();
  if (!name) return json({ error: "Give the server a name." }, 400);
  if (!/^https?:\/\//i.test(url)) return json({ error: "Enter the MCP server's URL (https://…)." }, 400);

  const authType = ["none", "apikey", "oauth", "identity"].includes(String(body.authType)) ? String(body.authType) : "none";
  let auth: Any = { type: "none" };
  let apiKeyEnc: string | null = null;
  if (authType === "apikey") {
    if (!body.apiKey) return json({ error: "Enter the API key for this server." }, 400);
    auth = { type: "apikey" };
    apiKeyEnc = await encrypt(String(body.apiKey));
  } else if (authType === "oauth") {
    if (!body.authProvider || !isProvider(body.authProvider)) return json({ error: "Pick a connected app for OAuth." }, 400);
    auth = { type: "oauth", provider: body.authProvider };
  } else if (authType === "identity") {
    // Delegated identity: the server is called AS the signed-in customer. `claim`
    // token -> Authorization: Bearer <token>; email/phone/sub -> a named header.
    const claim = ["token", "email", "phone", "sub"].includes(String(body.identityClaim)) ? String(body.identityClaim) : "token";
    if (claim === "token") auth = { type: "identity", claim: "token" };
    else {
      const defName = claim === "email" ? "X-User-Email" : claim === "phone" ? "X-User-Phone" : "X-User-Id";
      auth = { type: "identity", claim, name: (String(body.identityField ?? "").trim() || defName).slice(0, 60), prefix: "" };
    }
  }

  // Insert the server first so we have its id, then discover + register tools.
  const { data: inserted, error: insErr } = await db
    .from("mcp_server")
    .insert({ store_id: store.id, name, url, auth, api_key: apiKeyEnc, enabled: true })
    .select("id, store_id, name, url, auth, api_key, enabled")
    .single();
  if (insErr || !inserted) return json({ error: insErr?.message ?? "couldn't save the server" }, 500);

  const sync = await syncTools(db, store.id, inserted as McpServer);
  if (!sync.ok) {
    // Roll back — a server we can't reach/list is useless and just clutters the UI.
    await db.from("mcp_server").delete().eq("id", inserted.id);
    return json({ error: `Couldn't connect: ${sync.error ?? "the server didn't return any tools"}` }, 400);
  }
  return json({ ok: true, serverId: inserted.id, name, tools: sync.tools.map((t: Any) => ({ name: t.remote_name, description: t.description, side_effect: t.side_effect })) });
});
