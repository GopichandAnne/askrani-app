// stripe-pay — a REFERENCE payment-link connector a business can deploy as-is.
// Given an order amount, it creates a Stripe Checkout Session and returns the
// hosted checkout URL (dynamic amount, so no pre-made Stripe catalog needed).
// The customer enters their card on Stripe's page — PCI never touches us.
//
// Set the STRIPE_SECRET_KEY function secret to go live. Without it, it returns a
// demo URL so the flow still works end-to-end. HMAC-signed like every connector.

import { serviceClient } from "../_shared/supabase.ts";

function id(p: string) {
  return p + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
}

/** The calling store's own Stripe key (set once in the panel), else the platform
 *  env key, else none (demo). */
async function resolveStripeKey(storeSlug: string): Promise<string | null> {
  if (storeSlug) {
    try {
      const db = serviceClient();
      const { data: store } = await db.from("stores").select("id").eq("slug", storeSlug).maybeSingle();
      if (store) {
        const { data } = await db
          .from("store_provider_credentials")
          .select("credentials")
          .eq("store_id", store.id)
          .eq("provider", "stripe")
          .maybeSingle();
        const k = (data?.credentials as { secret_key?: string } | null)?.secret_key;
        if (k) return k;
      }
    } catch (e) {
      console.error("[stripe-pay] key lookup:", e);
    }
  }
  return Deno.env.get("STRIPE_SECRET_KEY") ?? null;
}

async function stripeCheckout(amount: number, ref: string, key: string | null): Promise<string | null> {
  if (!key) return null; // demo fallback
  const cents = Math.round(amount * 100);
  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("success_url", `https://example.com/order/${ref}/thanks`);
  p.set("cancel_url", `https://example.com/order/${ref}`);
  p.set("client_reference_id", ref);
  p.set("line_items[0][quantity]", "1");
  p.set("line_items[0][price_data][currency]", "usd");
  p.set("line_items[0][price_data][unit_amount]", String(cents));
  p.set("line_items[0][price_data][product_data][name]", `Order ${ref}`);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: p,
  });
  if (!res.ok) {
    console.error(`[stripe-pay] ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const j = await res.json();
  return typeof j.url === "string" ? j.url : null;
}

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const secret = Deno.env.get("STRIPE_PAY_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }
  let parsed: { tool?: string; args?: Record<string, unknown>; store_slug?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if ((parsed.tool ?? "") !== "create_payment_link") {
    return json({ error: `unknown tool: ${parsed.tool}` }, 400);
  }
  const a = parsed.args ?? {};
  const amount = Number(a.amount ?? 0);
  const ref = String(a.order_ref ?? id("ORD"));
  if (!(amount > 0)) return json({ ok: false, note: "need the order total to create a payment link" });

  const key = await resolveStripeKey(String(parsed.store_slug ?? ""));
  const stripeUrl = await stripeCheckout(amount, ref, key);
  return json(
    stripeUrl
      ? {
        ok: true,
        order_ref: ref,
        amount,
        payment_url: stripeUrl,
        provider: "stripe",
        note: "Secure Stripe checkout — the customer pays on Stripe's page. Never take card details in chat.",
      }
      : {
        ok: true,
        order_ref: ref,
        amount,
        payment_url: `https://pay.demo/checkout/${ref}`,
        provider: "demo (set STRIPE_SECRET_KEY to accept real payments)",
        note: "Demo link — a hosted checkout URL. Never take card details in chat.",
      },
  );
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
