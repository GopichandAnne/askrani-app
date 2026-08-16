// transcribe — server-side speech-to-text (OpenAI Whisper).
//
// The copilot mic tries the browser's on-device Web Speech API first (instant,
// free) but that only works in Chrome/Edge/Android-Chrome. Everywhere else — iOS
// Safari, the WhatsApp in-app browser, WebViews — the client records audio with
// MediaRecorder and POSTs it here, so voice works on every owner's phone.
//
// verify_jwt stays ON (default): only a signed-in owner can spend the STT key.
// Multipart passthrough: forward the uploaded audio straight to Whisper.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return json({ error: "voice transcription isn't configured" }, 503);

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch { /* bad body */ }
  if (!file || file.size === 0) return json({ error: "no audio" }, 400);
  if (file.size > 20 * 1024 * 1024) return json({ error: "audio too long" }, 413); // ~20MB cap

  const out = new FormData();
  out.append("file", file, file.name || "speech.webm");
  out.append("model", "whisper-1");
  // "translate" is available too; we want the owner's own language transcribed.
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
