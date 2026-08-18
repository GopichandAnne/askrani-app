// integration-build — the builder brain. The owner points Rani at an API (an
// OpenAPI/Swagger JSON URL + what they want it to do); we read the spec, let the
// model pick the relevant operations, and turn each into a callable tool
// (http_tool rows) the bot picks up automatically. Also lists/deletes tools.
//
// Owner-authed (verify_jwt ON). Any API key the owner supplies is AES-GCM
// encrypted (OAUTH_ENC_KEY) before storage; the model only ever sees operation
// shapes, never a credential. v1: JSON OpenAPI specs, API-key/bearer/none auth.

import { serviceClient } from "../_shared/supabase.ts";
import { generateStructured } from "../_shared/gemini.ts";
import { encrypt } from "../_shared/connections.ts";
import { executeHttpTool } from "../_shared/httptool.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
type Db = any;

function resolveRef(spec: Any, node: Any): Any {
  if (node && node.$ref && typeof node.$ref === "string") {
    const parts = node.$ref.replace(/^#\//, "").split("/");
    let cur: Any = spec;
    for (const p of parts) cur = cur?.[p];
    return cur ?? node;
  }
  return node;
}

/** Reduce a (possibly huge) OpenAPI doc to a compact operation list for the model. */
function compact(spec: Any): { base: string; auth: Any; ops: Any[] } {
  const base = spec.servers?.[0]?.url ?? "";
  const auth = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  const ops: Any[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = (item as Any)?.[method];
      if (!op) continue;
      const params = (op.parameters ?? []).map((p0: Any) => {
        const p = resolveRef(spec, p0);
        return { name: p.name, in: p.in, required: !!p.required, desc: String(p.description ?? "").slice(0, 80) };
      });
      let bodyProps: string[] = [];
      let requiredBody: string[] = [];
      const schema = resolveRef(spec, op.requestBody?.content?.["application/json"]?.schema);
      if (schema?.properties) { bodyProps = Object.keys(schema.properties).slice(0, 15); requiredBody = schema.required ?? []; }
      ops.push({
        method: method.toUpperCase(), path,
        summary: String(op.summary ?? op.description ?? "").slice(0, 120),
        params, bodyProps, requiredBody,
      });
    }
  }
  return { base, auth, ops: ops.slice(0, 60) };
}

function pickAuth(schemes: Any): Any {
  for (const s0 of Object.values(schemes ?? {})) {
    const s = s0 as Any;
    if (s.type === "apiKey") return { type: "apikey", location: s.in === "query" ? "query" : "header", name: s.name };
    if (s.type === "http" && s.scheme === "bearer") return { type: "apikey", location: "header", name: "Authorization", prefix: "Bearer " };
    if (s.type === "http" && s.scheme === "basic") return { type: "apikey", location: "header", name: "Authorization", prefix: "Basic " };
  }
  return { type: "none" };
}

const SYS = `You configure API tools for an AI assistant that serves a business's customers. You are given an API's operations and what the owner wants the assistant to be able to do. Choose the MOST RELEVANT operations (at most 5) and turn each into a tool.

For each tool return:
- "name": snake_case, <= 40 chars, unique, action-y (e.g. "get_order_status", "check_stock").
- "description": one plain line telling the assistant when to use it + what it returns.
- "method": the HTTP method.
- "path": the path exactly as given, KEEPING {placeholders}.
- "side_effect": true for POST/PUT/PATCH/DELETE (anything that changes data), else false.
- "params": a JSON-Schema object of the inputs the assistant must provide — the path params, the useful query params, and needed body fields. Mark "required" ONLY the ones the API requires. Give each a short "description".
- "request_map": an array of { "param": <name in params>, "in": "path" | "query" | "body" } for EVERY param.

Ground strictly in the operations provided — never invent endpoints, params, or paths. Prefer read-only lookups unless the goal clearly needs an action.

Respond with ONLY: {"tools": [ { "name","description","method","path","side_effect","params","request_map" } ]}`;

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

  let body: { action?: string; storeSlug?: string; openapiUrl?: string; goal?: string; apiKey?: string; toolId?: string; sampleArgs?: Record<string, unknown>; forwardIdentity?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const slug = String(body.storeSlug ?? "").trim().toLowerCase();
  if (!slug) return json({ error: "storeSlug required" }, 400);

  const db: Db = serviceClient();
  const { data: store } = await db.from("stores").select("id, slug").eq("slug", slug).maybeSingle();
  if (!store) return json({ error: "unknown store" }, 404);
  const [staffRes, adminRes] = await Promise.all([
    db.from("staff").select("role").eq("store_id", store.id).eq("user_id", userId).eq("status", "active").maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (!(staffRes.data?.role === "owner" || adminRes.data)) return json({ error: "forbidden — owner only" }, 403);

  const action = body.action ?? "build";

  if (action === "list") {
    const { data } = await db.from("http_tool").select("id, name, description, method, side_effect, auth, enabled").eq("store_id", store.id).order("created_at", { ascending: false });
    return json({ tools: data ?? [] });
  }
  if (action === "delete") {
    if (!body.toolId) return json({ error: "toolId required" }, 400);
    await db.from("http_tool").delete().eq("store_id", store.id).eq("id", body.toolId);
    return json({ ok: true });
  }
  // ── test (dry-run) ── make ONE real call to prove the mapping + auth work.
  // Never runs a write tool (side_effect) — those can only be tried by the bot,
  // with the customer's confirmation. Read tools are safe to probe.
  if (action === "test") {
    if (!body.toolId) return json({ error: "toolId required" }, 400);
    const { data: tool } = await db.from("http_tool").select("*").eq("store_id", store.id).eq("id", body.toolId).maybeSingle();
    if (!tool) return json({ error: "unknown tool" }, 404);
    if (tool.side_effect) {
      return json({ ok: false, skipped: true, note: "This tool changes data, so a dry test won't run it. It'll be tried live (with the customer's OK) when the bot needs it." });
    }
    if (tool.auth?.type === "identity") {
      return json({ ok: false, skipped: true, note: "This tool answers as the signed-in customer, so it can only be tested from a live chat where someone is logged in — not from here." });
    }
    const res = await executeHttpTool(db, store, tool, body.sampleArgs ?? {});
    const preview = res.ok ? JSON.stringify(res.result ?? "").slice(0, 300) : String(res.note ?? "The call failed.");
    return json({ ok: res.ok === true, preview });
  }

  // ── build ──
  const url = String(body.openapiUrl ?? "").trim();
  const goal = String(body.goal ?? "").trim() || "the useful lookups and actions for helping customers";
  if (!/^https?:\/\//i.test(url)) return json({ error: "Give an OpenAPI/Swagger JSON URL." }, 400);

  let spec: Any;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return json({ error: `Couldn't fetch the spec (HTTP ${r.status}).` }, 400);
    spec = JSON.parse((await r.text()).slice(0, 800_000));
  } catch {
    return json({ error: "Couldn't read that spec — make sure it's a JSON OpenAPI URL." }, 400);
  }

  const { base: specBase, auth: schemes, ops } = compact(spec);
  if (!ops.length) return json({ error: "No operations found in that spec." }, 400);
  // servers[0].url is often RELATIVE (e.g. Petstore's "/api/v3") — resolve it
  // against the spec's own URL so the base is absolute, else every call fails.
  let base = specBase;
  if (!/^https?:\/\//i.test(base)) {
    try { base = new URL(base || "/", url).href.replace(/\/$/, ""); } catch { base = ""; }
  }
  // Delegated identity: the owner says "this is my own app — call it as the
  // signed-in customer." We forward the visitor's verified token (Bearer) at
  // runtime instead of any store credential; the model never sees it.
  const forwardIdentity = body.forwardIdentity === true;
  const auth: Any = forwardIdentity
    ? { type: "identity", location: "header", name: "Authorization", prefix: "Bearer ", claim: "token" }
    : pickAuth(schemes);

  const opsText = ops.map((o) =>
    `${o.method} ${o.path} — ${o.summary}` +
    (o.params.length ? `\n  params: ${o.params.map((p: Any) => `${p.name}(${p.in}${p.required ? ",required" : ""})`).join(", ")}` : "") +
    (o.bodyProps.length ? `\n  body: ${o.bodyProps.join(", ")}${o.requiredBody.length ? ` (required: ${o.requiredBody.join(", ")})` : ""}` : ""),
  ).join("\n").slice(0, 8000);

  const out = await generateStructured(SYS, `WHAT THE OWNER WANTS: ${goal}\n\nAPI OPERATIONS:\n${opsText}\n\nReturn the tools JSON.`);
  const proposed = Array.isArray((out as Any)?.tools) ? (out as Any).tools : [];
  if (!proposed.length) return json({ error: "Couldn't turn that spec into tools — try describing what you want more specifically." }, 422);

  const apiKeyEnc = auth.type === "apikey" && body.apiKey ? await encrypt(String(body.apiKey)) : null;

  const rows: Any[] = [];
  for (const t of proposed.slice(0, 5)) {
    const name = String(t.name ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
    if (!name || !t.path || !t.method) continue;
    rows.push({
      store_id: store.id,
      name,
      description: String(t.description ?? name).slice(0, 400),
      method: String(t.method).toUpperCase(),
      base_url: base,
      path: String(t.path),
      params: t.params ?? { type: "object", properties: {}, required: [] },
      request_map: Array.isArray(t.request_map) ? t.request_map : [],
      auth,
      api_key: apiKeyEnc,
      side_effect: t.side_effect === true,
      enabled: true,
    });
  }
  if (!rows.length) return json({ error: "The generated tools were invalid — try again." }, 422);

  const { error } = await db.from("http_tool").upsert(rows, { onConflict: "store_id,name" });
  if (error) return json({ error: error.message }, 500);

  // Dry-run the safe ones before declaring victory: any read-only tool that needs
  // no required input, we actually call once to prove the base URL + auth + mapping
  // work end-to-end. Writes and tools that need a value can't be probed blindly, so
  // they're marked "untested" (the owner can Test them with a sample value).
  const created: Any[] = [];
  for (const r of rows) {
    const required: string[] = Array.isArray(r.params?.required) ? r.params.required : [];
    let tested: "ok" | "failed" | "skipped" = "skipped";
    // Identity tools need a live signed-in customer, so they can't be probed here.
    if (!r.side_effect && required.length === 0 && r.auth?.type !== "identity") {
      const res = await executeHttpTool(db, store, r, {});
      tested = res.ok ? "ok" : "failed";
    }
    created.push({ name: r.name, description: r.description, method: r.method, side_effect: r.side_effect, tested });
  }

  // If forwarding identity, the store needs embedded SSO configured (identity_secret
  // + access_control) or the tools have no verified visitor to act as. Flag it so
  // the panel can tell the owner what's still needed.
  let identity_ready = true;
  if (forwardIdentity) {
    const { data: s } = await db.from("stores").select("identity_secret, access_control").eq("id", store.id).maybeSingle();
    identity_ready = !!(s?.identity_secret && s?.access_control && s.access_control !== "open");
  }

  return json({
    ok: true,
    created,
    auth_needed: auth.type === "apikey" && !apiKeyEnc,
    identity: forwardIdentity,
    identity_ready,
    auth,
  });
});
