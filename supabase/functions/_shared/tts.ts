// Premium voice for the diner surface — OpenAI text-to-speech.
//
// UNLIKE Stripe (store's own key, store's cost), TTS is billed to OUR platform
// key, so cost control is load-bearing: every clip is cached in Storage keyed by
// (voice, text), and the caller caps text length. Rani's stock serving lines
// repeat constantly, so the cache absorbs most of the volume and only her unique
// per-question menu explanations ever hit OpenAI.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Owner-facing voice names → OpenAI voice + a rich DELIVERY instruction.
// gpt-4o-mini-tts sounds like "reading text" unless you direct HOW to speak — so
// these steer affect, rhythm, emphasis and (crucially) what to avoid, to get
// natural table-side conversation instead of an announcer. Female voices only.
// Shared across every voice so they all read as a person talking, not narrating.
const SHARED_STYLE =
  "You are a real server talking to a guest at their table — this is spoken conversation, NOT reading a message aloud. " +
  "Use relaxed, natural conversational rhythm: easy rises and falls in pitch, small pauses where a person would breathe, " +
  "and a light smile in the voice. Lightly emphasise dish names and the appealing, tasty words the way someone does when " +
  "they're genuinely recommending a favourite. Let it feel a touch spontaneous and human. " +
  "Absolutely avoid: a flat, even, robotic cadence; an announcer or news-reader tone; the clipped delivery of a phone menu " +
  "or voice assistant; and any sense of reading text word by word.";
export const TTS_VOICES: Record<string, { openai: string; instructions: string }> = {
  aria: { openai: "nova", instructions: `Affect: a warm, genuinely welcoming server who's glad to see this guest. Tone: friendly and unhurried, like chatting with a regular. ${SHARED_STYLE}` },
  sable: { openai: "shimmer", instructions: `Affect: a soft-spoken, gentle, caring server with a soothing presence. Tone: calm, warm and intimate, softly rounded and easy. ${SHARED_STYLE}` },
  coral: { openai: "coral", instructions: `Affect: a bright, upbeat, cheerful server who's genuinely excited about the food. Tone: lively, playful and warm — expressive rise and fall, but never rushed or salesy. ${SHARED_STYLE}` },
  sage: { openai: "sage", instructions: `Affect: a calm, poised, quietly confident server who makes guests feel looked after. Tone: reassuring, grounded and smooth, with natural phrasing. ${SHARED_STYLE}` },
};
// Bump when the instructions above change — it's part of the cache key, so old
// (differently-voiced) clips are invalidated and re-synthesized in the new style.
const STYLE_VERSION = "v2";
export const DEFAULT_VOICE = "aria";
export function resolveVoice(name?: string | null): { key: string; openai: string; instructions: string } {
  const key = (name ?? "").toLowerCase();
  const v = TTS_VOICES[key] ?? TTS_VOICES[DEFAULT_VOICE];
  return { key: TTS_VOICES[key] ? key : DEFAULT_VOICE, ...v };
}

const BUCKET = "tts-cache";

/** Raw OpenAI synthesis → MP3 bytes, or null on any failure (caller falls back). */
export async function synthesizeSpeech(text: string, voiceName: string): Promise<Uint8Array | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) {
    console.error("[tts] OPENAI_API_KEY not set");
    return null;
  }
  const v = resolveVoice(voiceName);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: v.openai,
        input: text,
        response_format: "mp3",
        instructions: v.instructions,
      }),
    });
    if (!res.ok) {
      console.error(`[tts] openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    console.error(`[tts] fetch: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function cachePath(voiceName: string, text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${STYLE_VERSION}\n${voiceName}\n${text}`));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${STYLE_VERSION}/${voiceName}/${hex}.mp3`;
}

/** Cache-first speech: serve the stored clip if we've said this line in this
 *  voice before; otherwise synthesize, store (best-effort), and serve. */
export async function cachedSpeech(db: SupabaseClient, voiceName: string, text: string): Promise<Uint8Array | null> {
  const path = await cachePath(voiceName, text);
  try {
    const { data: hit } = await db.storage.from(BUCKET).download(path);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { /* miss or bucket cold — fall through to synth */ }

  const bytes = await synthesizeSpeech(text, voiceName);
  if (!bytes) return null;
  try {
    await db.storage.from(BUCKET).upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
  } catch (e) {
    console.error(`[tts] cache upload: ${e instanceof Error ? e.message : e}`);
  }
  return bytes;
}
