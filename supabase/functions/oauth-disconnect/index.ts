// oauth-disconnect — disconnect a store from a provider (Google/Square/HubSpot).
//
// The owner clicks "Disconnect X" in the panel. We authorize the caller (store
// OWNER or platform admin), then call disconnect(), which best-effort REVOKES the
// grant at the provider (so access actually stops upstream, not just in our vault)
// and deletes our stored tokens. verify_jwt stays ON (default). All OAuth secrets
// live here in the edge runtime — never in the Next app.

import { serviceClient } from "../_shared/supabase.ts";
import { isProvider, disconnect, type ProviderId } from "../_shared/connections.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Db = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let userId = "";
  try {
    const seg = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").split(".")[1] ?? "";
    let s = seg.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    userId = JSON.parse(atob(s)).sub ?? "";
  } catch { /* ignore */ }
  if (!userId) return json({ error: "unauthorized" }, 401);

  let body: { storeSlug?: string; provider?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const slug = String(body.storeSlug ?? "").trim().toLowerCase();
  const provider = String(body.provider ?? "").trim().toLowerCase();
  if (!slug) return json({ error: "storeSlug required" }, 400);
  if (!isProvider(provider)) return json({ error: "unknown provider" }, 400);

  const db: Db = serviceClient();
  const { data: store } = await db.from("stores").select("id, slug").eq("slug", slug).maybeSingle();
  if (!store) return json({ error: "unknown store" }, 404);

  const [staffRes, adminRes] = await Promise.all([
    db.from("staff").select("role").eq("store_id", store.id).eq("user_id", userId).eq("status", "active").maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (!(staffRes.data?.role === "owner" || adminRes.data)) return json({ error: "forbidden — only the store owner can change connections" }, 403);

  try {
    await disconnect(db, store.id, provider as ProviderId);
    return json({ ok: true });
  } catch (e) {
    console.error(`[oauth-disconnect] ${e instanceof Error ? e.message : e}`);
    return json({ error: "couldn't disconnect" }, 500);
  }
});
