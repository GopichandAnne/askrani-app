// tts — premium voice for the diner surface (OpenAI text-to-speech).
//
// Returns MP3 audio for one of Rani's lines, in the store's chosen female voice.
// Token-validated like web-cart (verify_jwt stays on; the browser sends the anon
// key). Premium voice is ON for all catalogue stores; an owner can opt out with
// agent_config tts_enabled=false, in which case the diner falls back to the free
// browser voice. Cost is controlled by a hard length cap + Storage caching (see
// _shared/tts.ts).

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug } from "../_shared/config.ts";
import { cachedSpeech, resolveVoice } from "../_shared/tts.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const MAX_CHARS = 600; // cost guard — Rani's lines are short; long input is truncated

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const slug = String(body.slug ?? "").trim();
  const token = String(body.token ?? "").trim();
  const sessionId = String(body.session_id ?? "").trim();
  let text = String(body.text ?? "").replace(/[“”"]/g, "").trim();
  if (!slug || !sessionId.startsWith("web_")) return json({ error: "bad request" }, 400);
  if (!text) return json({ error: "no text" }, 400);
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

  const db = serviceClient();
  const store = await getStoreBySlug(db, slug);
  if (!store) return json({ error: "unknown store" }, 404);

  // Same visitor-token check as web-cart.
  const { data: tok } = await db
    .from("store_tokens")
    .select("active, listing_ref")
    .eq("store_id", store.id)
    .eq("token", token)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1);
  const tokRow = tok?.[0] as { active: boolean; listing_ref: string | null } | undefined;
  if (!tokRow || (!tokRow.active && !tokRow.listing_ref)) {
    return json({ error: "invalid or expired link" }, 403);
  }

  // Catalogue + premium-voice gates + the store's chosen voice, in one read.
  const { data: cfg } = await db
    .from("agent_config")
    .select("key, value")
    .eq("store_id", store.id)
    .in("key", ["catalog_enabled", "tts_enabled", "tts_voice"]);
  const conf = Object.fromEntries((cfg ?? []).map((r) => [r.key, String(r.value ?? "")]));
  if ((conf.catalog_enabled ?? "").toLowerCase() !== "true") {
    return json({ error: "catalogue not enabled" }, 403);
  }
  // Premium voice defaults ON for catalogue stores; only an explicit "false" opts out.
  if ((conf.tts_enabled ?? "true").toLowerCase() === "false") {
    return json({ disabled: true }, 403);
  }
  // A `voice` in the request overrides the saved one — this powers the owner
  // panel's per-voice preview (all four are valid + same cost, so no abuse risk).
  const reqVoice = String(body.voice ?? "").trim();
  const voice = reqVoice ? resolveVoice(reqVoice).key : resolveVoice(conf.tts_voice).key;

  const bytes = await cachedSpeech(db, voice, text, { svc: db, storeId: store.id, kind: "tts", ref: { sessionId } });
  if (!bytes) return json({ error: "voice unavailable" }, 502);
  // Copy into a plain ArrayBuffer (a valid, un-generic BodyInit) and stream it.
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return new Response(out, {
    headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" },
  });
});
