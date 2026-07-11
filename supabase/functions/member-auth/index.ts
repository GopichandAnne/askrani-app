// member-auth — self-serve web email verification (OTP). Two actions:
//   send_code   -> email a 6-digit code to the visitor (gated on the store's
//                  web_email_verification flag; rate-limited)
//   verify_code -> check the code, then bind the session to the matching member
// Anon-key gated (verify_jwt on, like web-chat). Off unless the owner enabled it.

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug } from "../_shared/config.ts";
import { sendEmail } from "../_shared/email.ts";
import { bindMemberSession, findMemberByIdentity } from "../_shared/members.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 45_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { action?: string; slug?: string; token?: string; session_id?: string; email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const action = String(body.action ?? "");
  const slug = String(body.slug ?? "").trim();
  const token = String(body.token ?? "").trim();
  const sessionId = String(body.session_id ?? "").trim();
  if (!slug || !token || !sessionId.startsWith("web_")) return json({ error: "bad request" }, 400);

  const db = serviceClient();
  const store = await getStoreBySlug(db, slug);
  if (!store) return json({ error: "unknown store" }, 404);

  // Token must be valid + active for this store.
  const { data: tok } = await db
    .from("store_tokens")
    .select("id")
    .eq("store_id", store.id)
    .eq("token", token)
    .eq("active", true)
    .limit(1);
  if (!tok || tok.length === 0) return json({ error: "invalid link" }, 403);

  // Owner gate: the feature must be turned on.
  const { data: srow } = await db
    .from("stores")
    .select("web_email_verification")
    .eq("id", store.id)
    .single();
  if (!srow?.web_email_verification) return json({ error: "email verification is off" }, 403);

  if (action === "send_code") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "enter a valid email" }, 400);

    // Cooldown: don't resend within the window.
    const { data: existing } = await db
      .from("web_verification_codes")
      .select("created_at")
      .eq("session_id", sessionId)
      .eq("store_id", store.id)
      .maybeSingle();
    if (existing && Date.now() - new Date(existing.created_at).getTime() < RESEND_COOLDOWN_MS) {
      return json({ error: "Please wait a moment before requesting another code." }, 429);
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();
    await db.from("web_verification_codes").upsert(
      { session_id: sessionId, store_id: store.id, email, code, attempts: 0, expires_at: expires, created_at: new Date().toISOString() },
      { onConflict: "session_id,store_id" },
    );
    const name = store.store_display_name ?? store.slug;
    const sent = await sendEmail(
      email,
      `Your ${name} verification code`,
      `Your verification code for ${name} is ${code}. It expires in ${CODE_TTL_MIN} minutes.\n\nIf you didn't request this, you can ignore this email.`,
    );
    // Report whether the email actually went out (depends on the store's email config).
    return json({ ok: true, sent });
  }

  if (action === "verify_code") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();
    const { data: row } = await db
      .from("web_verification_codes")
      .select("email, code, attempts, expires_at")
      .eq("session_id", sessionId)
      .eq("store_id", store.id)
      .maybeSingle();
    if (!row) return json({ verified: false, error: "Request a code first." }, 400);
    if (new Date(row.expires_at).getTime() < Date.now()) return json({ verified: false, error: "That code expired — request a new one." }, 400);
    if (row.attempts >= MAX_ATTEMPTS) return json({ verified: false, error: "Too many attempts — request a new code." }, 429);
    if (row.email !== email || row.code !== code) {
      await db.from("web_verification_codes").update({ attempts: row.attempts + 1 }).eq("session_id", sessionId).eq("store_id", store.id);
      return json({ verified: false, error: "That code doesn't match." }, 400);
    }
    // Correct: bind to the matching member (if any) and clear the code.
    const member = await findMemberByIdentity(db, store.id, email);
    if (member) await bindMemberSession(db, sessionId, store.id, member.id);
    await db.from("web_verification_codes").delete().eq("session_id", sessionId).eq("store_id", store.id);
    return json({ verified: true, member: member ? { role: member.role, name: member.name } : null });
  }

  return json({ error: "unknown action" }, 400);
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
