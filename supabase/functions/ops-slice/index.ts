// ops-slice — the read-only Rani operations aggregate for the Insights advisor.
//
// This closes the "one data umbrella": Insights watches the market (outside);
// Rani serves customers (inside). Insights PULLS this endpoint to ground its
// advisor in the business's OWN store data — real best-sellers, active promos,
// loyalty reach, and the promote-and-earn / co-marketing engine — so it can give
// advice like "don't discount your #1 seller" and "activate your advocates
// instead of buying ads."
//
// AGGREGATES ONLY. No raw customer PII crosses the boundary — counts, sums, item
// names, and (at most) a top-advocate display name. The two products stay in
// separate Supabase projects; this is a governed contract, not a schema reach-in.
//
// Auth: a shared secret INSIGHTS_OPS_SECRET, sent by Insights as
// `Authorization: Bearer <secret>` (or `x-ops-secret`). verify_jwt=false so the
// external caller can reach it (see config.toml). GET/POST with ?store=<slug>.

import { serviceClient } from "../_shared/supabase.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-ops-secret, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const WINDOW_DAYS = 45;

// deno-lint-ignore no-explicit-any
type Ops = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // shared-secret auth (no project JWT required; verify_jwt=false)
  const secret = Deno.env.get("INSIGHTS_OPS_SECRET");
  const authz = req.headers.get("authorization") ?? "";
  const provided = req.headers.get("x-ops-secret") ?? (authz.startsWith("Bearer ") ? authz.slice(7) : "");
  if (!secret || provided !== secret) return json({ error: "unauthorized" }, 401);

  let slug = new URL(req.url).searchParams.get("store") ?? "";
  if (!slug && req.method === "POST") { try { slug = ((await req.json()) as { store?: string })?.store ?? ""; } catch { /* ignore */ } }
  slug = String(slug).trim().toLowerCase();
  if (!slug) return json({ error: "store required" }, 400);

  const db = serviceClient();
  const { data: store } = await db.from("stores").select("id, slug, store_display_name, business_type").eq("slug", slug).maybeSingle();
  if (!store) return json({ error: "unknown store" }, 404);

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const ops: Ops = {};

  // ── Top sellers — aggregate items_json across recent orders ────────────────
  try {
    const { data: orders } = await db.from("orders").select("items_json").eq("store_slug", store.slug).gte("created_at", since).limit(3000);
    const counts = new Map<string, number>();
    for (const o of orders ?? []) {
      const items = Array.isArray((o as { items_json?: unknown }).items_json) ? (o as { items_json: unknown[] }).items_json : [];
      for (const it of items as { name?: string; quantity?: number }[]) {
        const name = String(it?.name ?? "").trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + (Number(it?.quantity) || 1));
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, orders]) => ({ name, orders }));
    if (top.length) ops.topItems = top;
  } catch { /* skip */ }

  // ── Active promos — running reward campaigns (the store's live offers) ─────
  try {
    const { data: camps } = await db.from("reward_campaigns").select("name, status").eq("store_id", store.id);
    const active = (camps ?? []).filter((c) => ["active", "live", "running"].includes(String((c as { status?: string }).status)))
      .map((c) => String((c as { name?: string }).name ?? "").trim()).filter(Boolean).slice(0, 6);
    if (active.length) ops.activePromos = active;
  } catch { /* skip */ }

  // ── Loyalty reach — active, unblocked members we can message ───────────────
  try {
    const { count } = await db.from("store_members").select("id", { count: "exact", head: true }).eq("store_id", store.id).eq("active", true).eq("blocked", false);
    if (count) ops.loyaltyContacts = count;
  } catch { /* skip */ }

  // ── Promote-and-earn — advocates, shares, credit issued, top advocate ──────
  try {
    const cm: Ops = {};
    const advocates = new Set<string>();
    const submissionsByMember = new Map<string, number>();

    const { data: subs } = await db.from("social_submissions").select("member_id").eq("store_id", store.id).gte("created_at", since).limit(5000);
    for (const s of subs ?? []) {
      const m = (s as { member_id?: string }).member_id;
      if (m) { advocates.add(m); submissionsByMember.set(m, (submissionsByMember.get(m) ?? 0) + 1); }
    }
    const shares = (subs ?? []).length;

    const { data: camps } = await db.from("reward_campaigns").select("id").eq("store_id", store.id);
    const campIds = (camps ?? []).map((c) => (c as { id: string }).id);
    if (campIds.length) {
      const { data: refs } = await db.from("referral_links").select("initiator_member_id").in("campaign_id", campIds).limit(5000);
      for (const r of refs ?? []) { const m = (r as { initiator_member_id?: string }).initiator_member_id; if (m) advocates.add(m); }
    }

    const { data: ledger } = await db.from("reward_ledger").select("amount_cents").eq("store_id", store.id).in("status", ["released", "redeemed"]).limit(20000);
    const cents = (ledger ?? []).reduce((a, l) => a + (Number((l as { amount_cents?: number }).amount_cents) || 0), 0);

    if (advocates.size) cm.advocates = advocates.size;
    if (shares) cm.shares = shares;
    if (cents > 0) cm.creditsIssued = `$${(cents / 100).toFixed(2)}`;

    const topId = [...submissionsByMember.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topId) {
      const { data: m } = await db.from("store_members").select("display_name").eq("id", topId).maybeSingle();
      const name = (m as { display_name?: string } | null)?.display_name;
      if (name) cm.topAdvocate = name;
    }
    if (Object.keys(cm).length) ops.coMarketing = cm;
  } catch { /* skip */ }

  // ── Request themes — what customers keep asking Rani for ───────────────────
  try {
    const { data: reqs } = await db.from("requests").select("type").eq("store_id", store.id).gte("created_at", since).limit(5000);
    const counts = new Map<string, number>();
    for (const r of reqs ?? []) { const t = String((r as { type?: string }).type ?? "").trim(); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
    const topKeys = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    if (topKeys.length) {
      const { data: types } = await db.from("request_types").select("key, label").eq("store_id", store.id);
      const labelBy = new Map((types ?? []).map((t) => [(t as { key: string }).key, (t as { label: string }).label]));
      ops.requestThemes = topKeys.map((k) => labelBy.get(k) ?? k);
    }
  } catch { /* skip */ }

  ops.at = new Date().toISOString();
  // audit the read (the existing insights-access table records who touched a store)
  try { await db.from("insights_access_audit").insert({ store_id: store.id, actor_email: "insights:ops-slice" }); } catch { /* best-effort */ }

  return json(ops);
});
