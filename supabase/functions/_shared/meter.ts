// Usage metering — records real COGS per AI action and debits the store's credit
// wallet (migration 0080). This is the ONE choke point: every cost-bearing call
// (Gemini chat, embeddings, vision, OpenAI TTS) routes its cost through here.
//
// Design, mirroring Ask Rani Insights:
//   • Record the RAW UNITS (tokens / chars) in usage_event.units — cost is derived
//     from a CENTRAL pricing table below, so we can re-price history later.
//   • Map cost → credits with the SAME cap as Insights (1 credit ≈ $0.02 COGS),
//     because it's one shared wallet across both products.
//   • FAIL-OPEN: metering never throws into the caller. A billing hiccup must not
//     block a customer's reply. Phase 1 is record-only (no gating).
//
// Rates are calibration PLACEHOLDERS, env-overridable, and only affect the derived
// cost — the stored units are ground truth. Update the table, not the call sites.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Where a metered call attributes its cost. Pass this into the provider client;
 *  omit it (e.g. health probes, no store) to skip metering entirely. */
export interface MeterCtx {
  svc: SupabaseClient;
  storeId: string;
  kind: string; // 'bot_chat' | 'followup_draft' | 'search_embed' | 'index_embed' | 'catalog_extract' | 'resume_parse' | 'plan_generate' | 'tts' | ...
  ref?: Record<string, unknown>;
}

// ── credit unit (shared with Insights) ───────────────────────────────────────
const CREDIT_COGS_CAP_USD = numEnv("CREDIT_COGS_CAP_USD", 0.02); // 1 credit covers ≤ $0.02 COGS

/** Credits a real USD cost maps to. 0 for free/zero-cost actions. */
export function creditsForCost(costUsd: number): number {
  if (!(costUsd > 0)) return 0;
  return Math.max(1, Math.ceil(costUsd / CREDIT_COGS_CAP_USD));
}

// ── pricing table (USD per 1,000,000 units) — placeholders, env-overridable ──
const PRICE = {
  // Gemini 2.5 Flash (per 1M tokens)
  gemini_in:     numEnv("PRICE_GEMINI_IN_PER_M", 0.30),
  gemini_out:    numEnv("PRICE_GEMINI_OUT_PER_M", 2.50),
  gemini_cached: numEnv("PRICE_GEMINI_CACHED_PER_M", 0.075),
  // gemini-embedding-001 (per 1M input tokens)
  embed_in:      numEnv("PRICE_EMBED_PER_M", 0.15),
  // OpenAI gpt-4o-mini-tts — priced per 1M characters (audio-dominated; approx)
  tts_chars:     numEnv("PRICE_TTS_PER_M_CHARS", 15.0),
};

export interface GeminiUsage {
  inputTokens: number;  // billable (non-cached) prompt tokens
  outputTokens: number; // candidates + thinking
  cachedTokens: number; // cached prefix (cheaper)
  calls: number;        // generateContent round-trips in this turn
}

export function emptyUsage(): GeminiUsage {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, calls: 0 };
}

/** Fold one response's usageMetadata into an accumulator. Gemini reports the TOTAL
 *  prompt tokens including cached, so bill (prompt − cached) at the input rate and
 *  the cached portion at the cheaper cached rate. */
export function addUsage(acc: GeminiUsage, usageMetadata: unknown): GeminiUsage {
  const u = (usageMetadata ?? {}) as Record<string, number>;
  const prompt = num(u.promptTokenCount);
  const cached = num(u.cachedContentTokenCount);
  const output = num(u.candidatesTokenCount) + num(u.thoughtsTokenCount);
  acc.inputTokens += Math.max(0, prompt - cached);
  acc.cachedTokens += cached;
  acc.outputTokens += output;
  acc.calls += 1;
  return acc;
}

/** USD for a Gemini chat/structured turn from accumulated token usage. */
export function geminiChatUsd(u: GeminiUsage): number {
  return (
    (u.inputTokens * PRICE.gemini_in) +
    (u.outputTokens * PRICE.gemini_out) +
    (u.cachedTokens * PRICE.gemini_cached)
  ) / 1_000_000;
}

/** USD for embedding `tokens` input tokens (estimated from text length upstream). */
export function geminiEmbedUsd(tokens: number): number {
  return (Math.max(0, tokens) * PRICE.embed_in) / 1_000_000;
}

/** USD for synthesizing `chars` characters of speech. */
export function ttsUsd(chars: number): number {
  return (Math.max(0, chars) * PRICE.tts_chars) / 1_000_000;
}

/** Rough token estimate for text where the provider doesn't return a count
 *  (embeddings): ~4 chars/token. Good enough for calibration; units are stored. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

/**
 * Record one metered call: write the raw usage_event AND debit the wallet, via the
 * atomic meter_record RPC. FAIL-OPEN — swallows every error so the caller (the bot)
 * is never affected. Skips the DB round-trip entirely when cost is zero but still
 * records the event for observability.
 */
export async function recordUsage(
  ctx: MeterCtx,
  provider: string,
  model: string,
  units: Record<string, unknown>,
  costUsd: number,
): Promise<void> {
  try {
    const credits = creditsForCost(costUsd);
    await ctx.svc.rpc("meter_record", {
      p_store_id: ctx.storeId,
      p_kind: ctx.kind,
      p_provider: provider,
      p_model: model,
      p_units: units,
      p_cost_usd: Number(costUsd.toFixed(6)),
      p_credits: credits,
      p_ref: ctx.ref ?? null,
    });
  } catch (e) {
    console.warn(`[meter] record failed (non-fatal): ${(e as Error)?.message ?? e}`);
  }
}

/**
 * Grace-then-stop credit gate. DORMANT unless CREDITS_ENFORCED=true, so today's
 * record-only stores (whose balances are allowed to run negative) are unaffected
 * until billing is deliberately switched on. When enabled, the bot keeps answering
 * until the balance falls below -CREDITS_GRACE, then stops. FAIL-OPEN on any error
 * or missing wallet — a billing read must never break a live bot.
 */
export async function creditGateOpen(svc: SupabaseClient, storeId: string): Promise<boolean> {
  if ((Deno.env.get("CREDITS_ENFORCED") ?? "").toLowerCase() !== "true") return true;
  const grace = numEnv("CREDITS_GRACE", 500);
  try {
    const { data } = await svc
      .from("wallet")
      .select("plan_credits, topup_credits")
      .eq("store_id", storeId)
      .maybeSingle();
    if (!data) return true; // no wallet row → never block
    // NB: balances can be negative (record-only overrun) — don't clamp with num().
    const balance = (Number(data.plan_credits) || 0) + (Number(data.topup_credits) || 0);
    return balance > -grace;
  } catch {
    return true; // fail-open
  }
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function numEnv(name: string, dflt: number): number {
  const v = parseFloat(Deno.env.get(name) ?? "");
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}
