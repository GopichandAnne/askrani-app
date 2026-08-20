// wallet — the shared credit wallet API for the "one account, one wallet" umbrella.
//
// Rani is the billing hub: every store has a credit wallet (migration 0080) that
// the chatbot debits locally. This endpoint lets Ask Rani INSIGHTS (a separate
// Supabase project) read and debit that SAME wallet, so a business's monitoring /
// deep-read / report spends draw from the one purse its chatbot usage draws from.
//
// Governed contract, not a schema reach-in — same posture as ops-slice:
//   Auth : shared secret INSIGHTS_OPS_SECRET (Authorization: Bearer <secret>
//          or x-ops-secret). verify_jwt=false so the external caller can reach it.
//   Key  : ?store=<slug> (the store the Insights workspace is linked to via
//          goals.raniStore — the same slug ops-slice uses).
//
// Actions (POST JSON { store, action, ... } or ?store=&action=):
//   • balance                                   → wallet summary
//   • debit  { credits, reason, cost_usd?, ref?, enforce? }
//        enforce=true refuses (ok:false) when the balance is short — used by
//        Insights' hard-gated purchases; otherwise it always records (fail-open
//        record-only, like the chatbot). Recorded as usage_event kind
//        'insights:<reason>' via the same atomic meter_record RPC.
//   • grant  { credits, reason, ref? }          → add top-up credits (refunds/promos)
//   • resolve_store { email }                    → slug of the store this verified
//        owner email owns (or null). No ?store=. Powers the Insights auto-link
//        (email→store) so both apps run on one wallet; see 0084 RPC.

import { serviceClient } from "../_shared/supabase.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-ops-secret, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Db = any;

async function walletSummary(db: Db, storeId: string) {
  const { data } = await db
    .from("wallet")
    .select("plan, plan_credits, topup_credits, trial_granted, status, total_spent, total_cost_usd")
    .eq("store_id", storeId)
    .maybeSingle();
  const w = data ?? { plan: "free", plan_credits: 0, topup_credits: 0, trial_granted: false, status: "active", total_spent: 0, total_cost_usd: 0 };
  return {
    balance: (Number(w.plan_credits) || 0) + (Number(w.topup_credits) || 0),
    plan: w.plan ?? "free",
    planCredits: Number(w.plan_credits) || 0,
    topupCredits: Number(w.topup_credits) || 0,
    status: w.status ?? "active",
    trialGranted: !!w.trial_granted,
    totalSpent: Number(w.total_spent) || 0,
    totalCostUsd: Number(w.total_cost_usd) || 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // shared-secret auth (no project JWT required; verify_jwt=false)
  const secret = Deno.env.get("INSIGHTS_OPS_SECRET");
  const authz = req.headers.get("authorization") ?? "";
  const provided = req.headers.get("x-ops-secret") ?? (authz.startsWith("Bearer ") ? authz.slice(7) : "");
  if (!secret || provided !== secret) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* ignore */ } }

  const slug = String(body.store ?? url.searchParams.get("store") ?? "").trim().toLowerCase();
  const action = String(body.action ?? url.searchParams.get("action") ?? "balance").trim();

  // resolve_store — email→store join for the Insights auto-link ("one account, one
  // wallet"). Given a verified owner email, returns the slug they own (or null).
  // Needs no ?store= (it's discovering the store), so handle before the slug gate.
  if (action === "resolve_store") {
    const email = String(body.email ?? url.searchParams.get("email") ?? "").trim().toLowerCase();
    if (!email) return json({ error: "email required" }, 400);
    const { data, error } = await serviceClient().rpc("store_slug_for_owner_email", { p_email: email });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, store: (data as string | null) ?? null });
  }

  if (!slug) return json({ error: "store required" }, 400);

  const db = serviceClient();
  const { data: store } = await db.from("stores").select("id, slug").eq("slug", slug).maybeSingle();
  if (!store) return json({ error: "unknown store" }, 404);
  const storeId = store.id as string;

  if (action === "balance") {
    return json({ ok: true, ...(await walletSummary(db, storeId)) });
  }

  if (action === "debit") {
    const credits = Math.max(0, Math.floor(Number(body.credits) || 0));
    const reason = String(body.reason ?? "insights").trim() || "insights";
    const enforce = body.enforce === true;
    const costUsd = Number(body.cost_usd) || 0;
    if (credits <= 0) return json({ ok: true, ...(await walletSummary(db, storeId)) }); // nothing to charge

    if (enforce) {
      const before = await walletSummary(db, storeId);
      if (before.balance < credits) return json({ ok: false, reason: "insufficient", ...before }, 200);
    }
    try {
      await db.rpc("meter_record", {
        p_store_id: storeId,
        p_kind: `insights:${reason}`,
        p_provider: "insights",
        p_model: null,
        p_units: body.ref ?? {},
        p_cost_usd: Number(costUsd.toFixed(6)),
        p_credits: credits,
        p_ref: body.ref ?? null,
      });
    } catch (e) {
      return json({ ok: false, error: `debit failed: ${(e as Error)?.message ?? e}` }, 500);
    }
    return json({ ok: true, charged: credits, ...(await walletSummary(db, storeId)) });
  }

  if (action === "grant") {
    const credits = Math.max(0, Math.floor(Number(body.credits) || 0));
    const reason = String(body.reason ?? "grant").trim() || "grant";
    if (credits <= 0) return json({ ok: true, ...(await walletSummary(db, storeId)) });
    try {
      // ensure the wallet row exists, then add persistent top-up credits + ledger
      await db.from("wallet").upsert({ store_id: storeId }, { onConflict: "store_id", ignoreDuplicates: true });
      const cur = await walletSummary(db, storeId);
      await db.from("wallet").update({ topup_credits: cur.topupCredits + credits, updated_at: new Date().toISOString() }).eq("store_id", storeId);
      await db.from("wallet_ledger").insert({ store_id: storeId, delta: credits, bucket: "topup", reason, ref: body.ref ?? null });
    } catch (e) {
      return json({ ok: false, error: `grant failed: ${(e as Error)?.message ?? e}` }, 500);
    }
    return json({ ok: true, granted: credits, ...(await walletSummary(db, storeId)) });
  }

  return json({ error: `unknown action: ${action}` }, 400);
});
