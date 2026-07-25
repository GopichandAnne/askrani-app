// stripe-webhook — a verified Stripe webhook, one URL per store (?store=<slug>).
// On a completed checkout it flips the referenced order to paid and alerts the
// store team; the POS then sees a paid order through the store's usual dispatch.
//
// verify_jwt is OFF (Stripe calls this directly, unauthenticated) — the security
// boundary is the Stripe signature check against the STORE's own webhook secret,
// so a forged call can't mark anything paid. Idempotent: only an unpaid order for
// THIS store flips, and only once.

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug } from "../_shared/config.ts";
import { notifyResponders } from "../_shared/responders.ts";
import { storeWebhookSecret, verifyStripeSignature } from "../_shared/stripe.ts";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const slug = (new URL(req.url).searchParams.get("store") ?? "").trim();
  if (!slug) return json({ error: "store required" }, 400);

  const db = serviceClient();
  const store = await getStoreBySlug(db, slug);
  if (!store) return json({ error: "unknown store" }, 404);

  const raw = await req.text();
  const secret = await storeWebhookSecret(db, store.id);
  if (!secret) {
    console.error(`[stripe-webhook] no webhook secret configured for ${slug}`);
    return json({ error: "not configured" }, 400);
  }
  if (!(await verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret))) {
    return json({ error: "bad signature" }, 400);
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const type = String(event?.type ?? "");
  if (type !== "checkout.session.completed" && type !== "payment_intent.succeeded") {
    return json({ received: true, ignored: type }); // ack + ignore (Stripe won't retry)
  }
  const obj = event?.data?.object ?? {};
  const orderId = String(obj?.metadata?.order_id ?? "").trim();
  if (!orderId) return json({ received: true, note: "no order_id in metadata" });
  const paymentRef = String(obj?.payment_intent ?? obj?.id ?? "");

  const { data: updated } = await db
    .from("orders")
    .update({ payment_status: "paid", payment_ref: paymentRef, paid_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("store_slug", slug)
    .neq("payment_status", "paid") // idempotent — a re-delivered webhook is a no-op
    .select("order_id, total, currency, table_label")
    .maybeSingle();

  if (updated) {
    const amt = updated.total != null ? `${updated.currency ?? "USD"} ${updated.total}` : "";
    const where = updated.table_label ? ` (${updated.table_label})` : "";
    await notifyResponders(
      db,
      store,
      "order",
      `Payment recorded for order ${orderId}${where} — ${amt} paid via Stripe. Ready to fire.`,
    );
  }
  return json({ received: true, order: orderId, marked_paid: !!updated });
});
