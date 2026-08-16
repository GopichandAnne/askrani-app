// transcribe — server-side speech-to-text (OpenAI Whisper), shared across the
// umbrella. The copilot mic tries the browser's on-device Web Speech API first
// (Chrome/Edge/Android); everywhere else — iOS Safari, the WhatsApp in-app
// browser, WebViews — the client records audio with MediaRecorder and POSTs it
// here so voice works on every owner's phone.
//
// Two callers, two auth paths (verify_jwt=false; we authenticate ourselves):
//   • Rani's own browser users  → Authorization: Bearer <user JWT> (validated).
//   • Ask Rani INSIGHTS (server) → the shared secret INSIGHTS_OPS_SECRET
//     (x-ops-secret or Bearer), so Insights borrows Rani's OpenAI key instead of
//     needing its own — same governed-contract pattern as ops-slice / wallet.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-ops-secret, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/** Validate a Rani end-user's JWT (the browser path). */
async function isRaniUser(token: string): Promise<boolean> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anon) return false;
    const supa = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data } = await supa.auth.getUser();
    return !!data?.user;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // ── auth: shared secret (Insights server) OR a valid Rani user JWT (browser) ──
  const secret = Deno.env.get("INSIGHTS_OPS_SECRET");
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  const providedSecret = req.headers.get("x-ops-secret") ?? bearer;
  let authed = !!secret && providedSecret === secret;
  if (!authed && bearer) authed = await isRaniUser(bearer);
  if (!authed) return json({ error: "unauthorized" }, 401);

  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return json({ error: "voice transcription isn't configured" }, 503);

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch { /* bad body */ }
  if (!file || file.size === 0) return json({ error: "no audio" }, 400);
  if (file.size > 20 * 1024 * 1024) return json({ error: "audio too long" }, 413);

  const out = new FormData();
  out.append("file", file, file.name || "speech.webm");
  out.append("model", "whisper-1");
  try {
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: out,
    });
    if (!r.ok) {
      console.error(`[transcribe] whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return json({ error: "couldn't transcribe" }, 502);
    }
    const d = await r.json();
    return json({ text: String(d.text ?? "").trim() });
  } catch (e) {
    console.error(`[transcribe] ${e instanceof Error ? e.message : e}`);
    return json({ error: "couldn't transcribe" }, 502);
  }
});
