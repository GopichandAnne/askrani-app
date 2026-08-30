import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook for credit top-ups. Verifies the signature with the dedicated
 * STRIPE_TOPUP_WEBHOOK_SECRET (its own endpoint, separate from the store-order
 * connector), then credits the SHARED Rani wallet the bot draws from. The credit
 * is atomic + idempotent inside wallet_topup (a webhook can fire more than once).
 *
 * No Stripe SDK: verification is HMAC-SHA256 over `${t}.${rawBody}` per Stripe's
 * scheme, matching the codebase's dependency-free posture.
 */
function verifySignature(payload: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_TOPUP_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature") ?? "";
  const payload = await req.text();

  // Descriptive bodies so the Stripe delivery "Response" tab explains every outcome.
  if (!secret) return new Response("skip: STRIPE_TOPUP_WEBHOOK_SECRET not set on askrani-app", { status: 503 });
  if (!sig) return new Response("skip: no stripe-signature header", { status: 400 });
  if (!verifySignature(payload, sig, secret)) {
    return new Response("skip: signature mismatch — secret must match THIS endpoint and mode", { status: 400 });
  }

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("skip: bad json", { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return new Response(`skip: type=${event.type}`, { status: 200 });
  }
  const session = (event.data?.object ?? {}) as {
    mode?: string;
    payment_status?: string;
    client_reference_id?: string;
    metadata?: Record<string, string>;
    id?: string;
  };
  // A 100%-off coupon (or any zero-total) completes as "no_payment_required", not
  // "paid" — still a valid purchase that should grant credits.
  const settled = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (session.mode !== "payment" || !settled) {
    return new Response(`skip: mode=${session.mode} payment_status=${session.payment_status}`, { status: 200 });
  }

  const storeId = session.metadata?.storeId || session.client_reference_id || "";
  const creditsRaw = session.metadata?.credits ?? "";
  const credits = parseInt(creditsRaw, 10);
  if (!storeId || !Number.isFinite(credits) || credits <= 0 || !event.id) {
    return new Response(`skip: storeId=${storeId || "MISSING"} credits=${creditsRaw || "MISSING"}`, { status: 200 });
  }

  const db = createAdminClient();
  const { data, error } = await db.rpc("wallet_topup", {
    p_store_id: storeId,
    p_credits: credits,
    p_reason: "topup_purchase",
    p_event_id: event.id,
    p_ref: { session: session.id ?? null, key: session.metadata?.key ?? null },
  });
  if (error) return new Response(`error: wallet_topup — ${error.message}`, { status: 500 });
  return new Response(
    data === false ? "ok: duplicate (already credited)" : `ok: credited ${credits} to ${storeId}`,
    { status: 200 },
  );
}
