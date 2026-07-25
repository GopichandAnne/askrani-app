// Stripe helpers for the diner "Pay now" flow. Direct-keys model: the store connects
// its OWN Stripe account (store_provider_credentials, provider 'stripe',
// credentials = { secret_key, webhook_secret }). Money goes straight to the store;
// we only orchestrate. No card data ever touches us (Stripe hosts the checkout).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type StripeCreds = { secret_key?: string; webhook_secret?: string };

async function creds(db: SupabaseClient, storeId: string): Promise<StripeCreds | null> {
  const { data } = await db
    .from("store_provider_credentials")
    .select("credentials, connected")
    .eq("store_id", storeId)
    .eq("provider", "stripe")
    .maybeSingle();
  if (!data || data.connected === false) return null;
  return (data.credentials ?? {}) as StripeCreds;
}

/** The store's own Stripe secret key (or the platform env key as a dev fallback). */
export async function storeStripeKey(db: SupabaseClient, storeId: string): Promise<string | null> {
  const c = await creds(db, storeId);
  return c?.secret_key || Deno.env.get("STRIPE_SECRET_KEY") || null;
}

export async function storeWebhookSecret(db: SupabaseClient, storeId: string): Promise<string | null> {
  const c = await creds(db, storeId);
  return c?.webhook_secret || Deno.env.get("STRIPE_WEBHOOK_SECRET") || null;
}

/** Create a hosted Checkout Session for one order. Returns the URL, or null on error. */
export async function createCheckoutSession(
  key: string,
  opts: { amount: number; currency: string; ref: string; name: string; metadata: Record<string, string>; successUrl: string; cancelUrl: string },
): Promise<string | null> {
  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("success_url", opts.successUrl);
  p.set("cancel_url", opts.cancelUrl);
  p.set("client_reference_id", opts.ref);
  p.set("line_items[0][quantity]", "1");
  p.set("line_items[0][price_data][currency]", (opts.currency || "usd").toLowerCase());
  p.set("line_items[0][price_data][unit_amount]", String(Math.round(opts.amount * 100)));
  p.set("line_items[0][price_data][product_data][name]", opts.name);
  for (const [k, v] of Object.entries(opts.metadata)) p.set(`metadata[${k}]`, v);
  // Stripe copies session metadata onto the PaymentIntent too, so the webhook has it.
  for (const [k, v] of Object.entries(opts.metadata)) p.set(`payment_intent_data[metadata][${k}]`, v);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: p,
  });
  if (!res.ok) {
    console.error(`[stripe] checkout ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const j = await res.json();
  return typeof j.url === "string" ? j.url : null;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Stripe webhook signature (their v1 scheme): expected =
 * HMAC-SHA256(secret, `${t}.${payload}`), compared to a v1 in the Stripe-Signature
 * header, within a timestamp tolerance. Returns false on any doubt.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, ...rest] = kv.split("=");
      return [k.trim(), rest.join("=")];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  if (!Number.isFinite(t)) return false;
  // reject stale/forged timestamps (uses real time — fine outside the workflow sandbox)
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const v1s = header
    .split(",")
    .filter((kv) => kv.trim().startsWith("v1="))
    .map((kv) => kv.trim().slice(3));
  if (v1s.length === 0) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = hex(mac);
  return v1s.some((v) => timingSafeEqual(v, expected));
}
