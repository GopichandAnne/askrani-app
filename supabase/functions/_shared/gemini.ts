// Gemini client (AI Studio API key path) — Bot Phase 2.
//
// Reads GEMINI_API_KEY from the function env (set via `supabase secrets set` for
// deploy, or supabase/functions/.env locally). Implicit caching is automatic on
// the 2.5 models for repeated prefixes — there is no flag to set; we earn cache
// hits purely by keeping `systemInstruction` stable and appending volatile turns
// last (see prompt.ts). Watch usageMetadata.cachedContentTokenCount to confirm.
//
// Best-effort: a missing key, HTTP error, or exception returns null rather than
// throwing, so intake never breaks. With no key the bot simply stays quiet —
// the inbound is still persisted by the webhook.

import type { Content } from "./prompt.ts";

const DEFAULT_MODEL = "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiResult {
  text: string | null;
  /** Tokens served from the implicit cache, if reported (0 / undefined = miss). */
  cachedTokens?: number;
}

/**
 * Generate a reply. `systemInstruction` is the stable cacheable prefix;
 * `contents` is history + the new message (new message last). Returns
 * { text: null } when GEMINI_API_KEY is unset or the call fails.
 */
export async function generateReply(
  systemInstruction: string,
  contents: Content[],
): Promise<GeminiResult> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    console.warn("[gemini] GEMINI_API_KEY not set — skipping reply (inbound still logged)");
    return { text: null };
  }
  const model = Deno.env.get("GEMINI_MODEL") ?? DEFAULT_MODEL;

  try {
    const res = await fetch(
      `${API_BASE}/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
        }),
      },
    );
    if (!res.ok) {
      console.error(`[gemini] ${res.status}: ${await res.text()}`);
      return { text: null };
    }
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json();
    const text: string | null =
      json?.candidates?.[0]?.content?.parts
        ?.map((p: Part) => p.text ?? "")
        .join("")
        .trim() || null;
    const cachedTokens: number | undefined =
      json?.usageMetadata?.cachedContentTokenCount;
    if (cachedTokens) console.log(`[gemini] cache hit: ${cachedTokens} tokens`);
    return { text, cachedTokens };
  } catch (err) {
    console.error("[gemini] error:", err);
    return { text: null };
  }
}

interface Part {
  text?: string;
}
