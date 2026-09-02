// LLM dispatcher — routes a turn to the store's chosen provider, defaulting to
// Gemini. Every adapter shares the same contract (generateReply's signature +
// GeminiReply), so swapping the model never touches the conversation code, the
// toolset, holds, sentiment, or RAG.
//
// Non-breaking by design: a store with no model set (the common case) → Gemini,
// exactly as before. Platform keys (ANTHROPIC_API_KEY / OPENAI_API_KEY) power the
// alternatives; if the chosen provider's key is unset we fall back to Gemini at
// dispatch time (before any tool runs — no side-effect risk) so the bot stays live.
import { generateReply, type GeminiContent, type GeminiReply } from "./gemini.ts";
import { anthropicReply } from "./anthropic.ts";
import { openaiReply } from "./openai.ts";
import type { Toolset } from "./tools.ts";
import type { MeterCtx } from "./meter.ts";

export interface ModelChoice {
  model_provider?: string | null;
  model_name?: string | null;
}

export async function generateReplyWith(
  choice: ModelChoice | null | undefined,
  systemInstruction: string,
  contents: GeminiContent[],
  toolset?: Toolset,
  meter?: MeterCtx,
): Promise<GeminiReply> {
  const provider = (choice?.model_provider || "gemini").toLowerCase();
  const model = choice?.model_name || undefined;

  if (provider === "anthropic" || provider === "claude") {
    if (Deno.env.get("ANTHROPIC_API_KEY")) {
      return await anthropicReply(model, systemInstruction, contents, toolset, meter);
    }
    console.warn("[llm] anthropic selected but ANTHROPIC_API_KEY unset — using gemini");
  } else if (provider === "openai" || provider === "gpt") {
    if (Deno.env.get("OPENAI_API_KEY")) {
      return await openaiReply(model, systemInstruction, contents, toolset, meter);
    }
    console.warn("[llm] openai selected but OPENAI_API_KEY unset — using gemini");
  }

  return await generateReply(systemInstruction, contents, toolset, meter);
}
