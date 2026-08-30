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
  if (!secret) return new Response("not configured", { status: 503 });

  const sig = req.headers.get("stripe-signature") ?? "";
  const payload = await req.text();
  if (!verifySignature(payload, sig, secret)) return new Response("bad signature", { status: 400 });

  let event: {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Only paid one-time checkouts credit the wallet.
  if (event.type !== "checkout.session.completed") return new Response("ignored", { status: 200 });
  const session = (event.data?.object ?? {}) as {
    mode?: string;
    payment_status?: string;
    client_reference_id?: string;
    metadata?: Record<string, string>;
    id?: string;
  };
  if (session.mode !== "payment" || session.payment_status !== "paid") return new Response("ignored", { status: 200 });

  const storeId = session.metadata?.storeId || session.client_reference_id || "";
  const credits = parseInt(session.metadata?.credits ?? "", 10);
  if (!storeId || !Number.isFinite(credits) || credits <= 0 || !event.id) {
    return new Response("no target", { status: 200 });
  }

  try {
    const db = createAdminClient();
    await db.rpc("wallet_topup", {
      p_store_id: storeId,
      p_credits: credits,
      p_reason: "topup_purchase",
      p_event_id: event.id,
      p_ref: { session: session.id ?? null, key: session.metadata?.key ?? null },
    });
  } catch (e) {
    // Let Stripe retry on a transient failure.
    return new Response(`error: ${(e as Error).message}`, { status: 500 });
  }
  return new Response("ok", { status: 200 });
}
