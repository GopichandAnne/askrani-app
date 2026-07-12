// career-intake — recruiting-lead connector for the web assistant.
//
// The bot calls tool `capture_career_interest` after a visitor confirms they're
// looking for work and has given: the roles they want, their key skills, and an
// email. This function verifies the HMAC signature, writes one row to
// public.career_requests, and emails HR. It performs a write (side_effect), so
// the bot only calls it once the visitor has confirmed.
//
// HR is notified through the SAME per-store escalation list every store already
// uses (store_responders with notify_escalations) — so this stays generic for
// any store, not a hardcoded recipient. Configure who gets it on the Team page.
//
// Secrets (Supabase function env):
//   CAREER_INTAKE_SECRET  — shared HMAC secret (must match the store_integrations
//                           auth_secret registered via bot-admin set_integration)
//   GMAIL_USER / GMAIL_APP_PASSWORD — outbound email (see _shared/email.ts)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — DB write (see _shared/supabase.ts)

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug } from "../_shared/config.ts";
import { notifyResponders } from "../_shared/responders.ts";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" +
    [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

/** Accept either an array of strings or a free-text string; return a clean line. */
function toLine(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(", ");
  return String(v ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const raw = await req.text();
  const secret = Deno.env.get("CAREER_INTAKE_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }

  let parsed: { tool?: string; args?: Record<string, unknown>; store_slug?: string; session_id?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }

  if ((parsed.tool ?? "") !== "capture_career_interest") {
    return json({ error: `unknown tool: ${parsed.tool}` }, 400);
  }

  const a = parsed.args ?? {};
  const email = String(a.email ?? "").trim();
  const positions = toLine(a.positions);
  const skills = toLine(a.skills);
  const notes = toLine(a.notes);
  const slug = String(parsed.store_slug ?? "").trim();

  // Basic email sanity — the bot is asked to collect a real address, but guard.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: "A valid email is required to file the request." }, 200);
  }
  if (!positions && !skills) {
    return json({ ok: false, error: "Please capture at least the roles or the skills first." }, 200);
  }

  const db = serviceClient();
  const store = await getStoreBySlug(db, slug);
  if (!store) return json({ ok: false, error: `unknown store: ${slug}` }, 200);

  const { data: inserted, error } = await db
    .from("career_requests")
    .insert({
      store_id: store.id,
      email,
      positions: positions || null,
      skills: skills || null,
      notes: notes || null,
      session_id: parsed.session_id ?? null,
    })
    .select("id")
    .single();
  if (error) return json({ ok: false, error: error.message }, 200);

  // Notify HR through the store's own escalation responders (generic per-store,
  // WhatsApp + email). Best-effort — never blocks the visitor's confirmation.
  const orgName = store.store_display_name ?? store.slug;
  const summary = [
    `New career interest — ${orgName}`,
    ``,
    `Email:     ${email}`,
    `Positions: ${positions || "—"}`,
    `Skills:    ${skills || "—"}`,
    notes ? `Notes:     ${notes}` : undefined,
  ].filter((l) => l !== undefined).join("\n");
  try {
    await notifyResponders(db, store, "escalation", summary, {
      subject: `New career interest — ${orgName}`,
      emailBody: `${summary}\n\nReview and reach back: https://app.askrani.ai/career-requests`,
    });
  } catch (e) {
    console.error(`[career-intake] notify failed: ${e instanceof Error ? e.message : e}`);
  }

  return json({
    ok: true,
    reference: inserted.id,
    message: "Your interest has been shared with our team — they'll reach out by email.",
  });
});
