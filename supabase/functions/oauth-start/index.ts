// oauth-start — begin connecting a store to a provider (Google/Square/HubSpot).
//
// The owner clicks "Connect X" in the panel; the client invokes this with the
// store slug + provider. We authorize the caller (must be the store's OWNER or a
// platform admin), mint a short-lived HMAC-signed `state` carrying the store +
// provider, and return the provider's authorize URL for the browser to redirect
// to. No tokens here — that's the callback. verify_jwt stays ON (default).

import { serviceClient } from "../_shared/supabase.ts";
import { PROVIDERS, isProvider, providerClient, buildAuthorizeUrl, signState, type ProviderId } from "../_shared/connections.ts";

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

  // Read the user from the (platform-verified) JWT — base64url segment.
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

  // Authorize: OWNER of this store, or a platform admin. Connecting third-party
  // accounts is owner-level (it grants Rani access to their systems).
  const [staffRes, adminRes] = await Promise.all([
    db.from("staff").select("role").eq("store_id", store.id).eq("user_id", userId).eq("status", "active").maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  const isOwner = staffRes.data?.role === "owner" || !!adminRes.data;
  if (!isOwner) return json({ error: "forbidden — only the store owner can connect accounts" }, 403);

  const client = providerClient(provider as ProviderId);
  if (!client) return json({ error: `${PROVIDERS[provider as ProviderId].label} isn't configured yet — the app credentials aren't set.` }, 503);

  try {
    const state = await signState({
      sid: store.id, prov: provider as ProviderId, uid: userId,
      exp: Math.floor(Date.now() / 1000) + 600, // 10 min
      n: crypto.randomUUID(),
    });
    const url = buildAuthorizeUrl(provider as ProviderId, client.clientId, state);
    return json({ url });
  } catch (e) {
    console.error(`[oauth-start] ${e instanceof Error ? e.message : e}`);
    return json({ error: "couldn't start the connection" }, 500);
  }
});
