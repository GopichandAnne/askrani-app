// Premium voice for the diner surface — OpenAI text-to-speech.
//
// UNLIKE Stripe (store's own key, store's cost), TTS is billed to OUR platform
// key, so cost control is load-bearing: every clip is cached in Storage keyed by
// (voice, text), and the caller caps text length. Rani's stock serving lines
// repeat constantly, so the cache absorbs most of the volume and only her unique
// per-question menu explanations ever hit OpenAI.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Owner-facing voice names → OpenAI voice + a hospitality tone instruction.
// Female voices only (product decision). The owner-facing name decouples us from
// OpenAI's internal labels.
export const TTS_VOICES: Record<string, { openai: string; instructions: string }> = {
  aria: { openai: "nova", instructions: "You are a warm, friendly restaurant host. Speak naturally and unhurried, welcoming the guest." },
  sable: { openai: "shimmer", instructions: "Speak softly and gently, calm and kind, like a soothing host." },
  coral: { openai: "coral", instructions: "Speak brightly and warmly, upbeat and cheerful but never rushed." },
  sage: { openai: "sage", instructions: "Speak calmly and clearly, poised and reassuring." },
};
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
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${voiceName}\n${text}`));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${voiceName}/${hex}.mp3`;
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
