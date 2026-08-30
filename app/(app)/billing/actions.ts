"use server";

import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { availablePacks, isBillingConfigured, packByKey, priceIdFor } from "@/lib/billing/topups";

const CONSOLE = (process.env.CONSOLE_URL || "https://app.askrani.ai").replace(/\/$/, "");

async function requireStoreAccess(storeId: string) {
  const ctx = await getSessionContext();
  const allowed =
    !!ctx && (ctx.isPlatformAdmin || ctx.stores.some((s) => s.id === storeId && s.role === "owner"));
  if (!allowed) throw new Error("Not authorized");
}

export type WalletView = {
  balance: number;
  planCredits: number;
  topupCredits: number;
  plan: string;
  status: string;
  totalSpent: number;
};

export async function getWallet(storeId: string): Promise<WalletView> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const { data } = await db
    .from("wallet")
    .select("plan, plan_credits, topup_credits, status, total_spent")
    .eq("store_id", storeId)
    .maybeSingle();
  const w = data ?? { plan: "free", plan_credits: 0, topup_credits: 0, status: "active", total_spent: 0 };
  return {
    balance: (w.plan_credits ?? 0) + (w.topup_credits ?? 0),
    planCredits: w.plan_credits ?? 0,
    topupCredits: w.topup_credits ?? 0,
    plan: w.plan ?? "free",
    status: w.status ?? "active",
    totalSpent: Number(w.total_spent ?? 0),
  };
}

export type LedgerRow = { ts: string; delta: number; bucket: string; reason: string };

export async function getLedger(storeId: string): Promise<LedgerRow[]> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  const { data } = await db
    .from("wallet_ledger")
    .select("ts, delta, bucket, reason")
    .eq("store_id", storeId)
    .order("ts", { ascending: false })
    .limit(40);
  return (data ?? []).map((r) => ({
    ts: r.ts as string,
    delta: Number(r.delta),
    bucket: (r.bucket as string) ?? "",
    reason: (r.reason as string) ?? "",
  }));
}

export type BillingConfig = {
  configured: boolean;
  packs: { key: string; label: string; credits: number; priceUsd: number }[];
};

export async function getBillingConfig(): Promise<BillingConfig> {
  return {
    configured: isBillingConfigured(),
    packs: availablePacks().map((p) => ({ key: p.key, label: p.label, credits: p.credits, priceUsd: p.priceUsd })),
  };
}

/** Create a Stripe Checkout Session for a top-up pack; returns the hosted URL.
 *  Raw REST (no SDK dep) — mirrors the store-order connector's posture. */
export async function createTopupCheckout(
  storeId: string,
  key: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireStoreAccess(storeId);
  if (!isBillingConfigured()) return { ok: false, error: "Billing isn't set up yet." };
  const pack = packByKey(key);
  if (!pack) return { ok: false, error: "Unknown pack." };
  const priceId = priceIdFor(pack);
  if (!priceId) return { ok: false, error: "That pack isn't configured in Stripe yet." };

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("client_reference_id", storeId);
  params.set("metadata[storeId]", storeId);
  params.set("metadata[key]", pack.key);
  params.set("metadata[credits]", String(pack.credits));
  params.set("success_url", `${CONSOLE}/billing?purchase=success`);
  params.set("cancel_url", `${CONSOLE}/billing?purchase=cancelled`);
  params.set("allow_promotion_codes", "true");
  params.set("billing_address_collection", "required");
  params.set("invoice_creation[enabled]", "true");

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error?.message ?? "Checkout failed." };
    if (!data?.url) return { ok: false, error: "Stripe did not return a checkout URL." };
    return { ok: true, url: data.url as string };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
