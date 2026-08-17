// detect-business — the "one question" onboarding auto-fill.
//
// Rani's setup interview learns a single identifier from the owner — a street
// ADDRESS (a local storefront) or a WEBSITE (an online/product company) — and calls
// this to fill in everything else from public data, so the owner CONFIRMS instead
// of typing it all out. We borrow Insights' discovery (Google Places + a homepage
// read) via the shared-secret contract, exactly like Insights borrows Rani's
// Whisper: Rani holds no Places/crawl stack, Insights holds no Rani session.
//
// Un-metered on purpose: a place-details lookup is a few tenths of a cent, and
// eating that to make setup frictionless is worth more than the charge. The deep,
// credit-metered scans stay behind the explicit Insights opt-in.
//
// verify_jwt stays ON (default) — only a signed-in owner in the welcome flow
// triggers it. Fail-soft: any miss returns { detected: null } so setup never
// dead-ends on a lookup.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { kind?: string; query?: string; name?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const kind = body.kind === "online" ? "online" : "local";
  const query = String(body.query ?? "").trim();
  if (!query) return json({ detected: null, source: "none" });

  const base = (Deno.env.get("INSIGHTS_API_URL") || "https://insights.askrani.ai").replace(/\/$/, "");
  const secret = Deno.env.get("INSIGHTS_OPS_SECRET");
  if (!secret) {
    console.warn("[detect-business] INSIGHTS_OPS_SECRET not set — skipping auto-detect");
    return json({ detected: null, source: "none" });
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 18000);
    const r = await fetch(`${base}/api/rani/detect`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ kind, query, name: body.name }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      console.warn(`[detect-business] insights detect ${r.status}`);
      return json({ detected: null, source: "none" });
    }
    const data = await r.json();
    return json({ detected: data?.detected ?? null, source: data?.source ?? "none" });
  } catch (e) {
    console.warn(`[detect-business] ${e instanceof Error ? e.message : e}`);
    return json({ detected: null, source: "none" });
  }
});
