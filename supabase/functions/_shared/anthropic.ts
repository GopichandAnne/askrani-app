// Anthropic (Claude) adapter — same contract as gemini.generateReply, so the LLM
// dispatcher can swap providers per store without the conversation code caring.
// Raw HTTP (Deno). Platform key: ANTHROPIC_API_KEY. Fail-open (text:null) exactly
// like the Gemini path, so a missing key or a bad call never breaks intake.
//
// The shared history is Gemini-shaped (GeminiContent[]); stored customer history is
// text (+ the current turn's image), so we convert text/inlineData here and manage
// tool_use / tool_result natively inside our own loop.
import type { Toolset } from "./tools.ts";
import type { GeminiContent, GeminiReply } from "./gemini.ts";
import { recordUsage, type MeterCtx } from "./meter.ts";

const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOOL_ITERATIONS = 6;

// deno-lint-ignore no-explicit-any
type Blk = Record<string, any>;
interface Msg {
  role: "user" | "assistant";
  content: Blk[];
}

function num(v: unknown): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/** GeminiContent[] → Anthropic messages (text + base64 image blocks). */
function toMessages(contents: GeminiContent[]): Msg[] {
  const out: Msg[] = [];
  for (const c of contents) {
    const role: "user" | "assistant" = c.role === "model" ? "assistant" : "user";
    const blocks: Blk[] = [];
    for (const p of c.parts) {
      if (p.text) blocks.push({ type: "text", text: p.text });
      else if (p.inlineData) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data },
        });
      }
    }
    if (blocks.length) out.push({ role, content: blocks });
  }
  return out;
}

/** Rough USD for observability/metering — record-only, approximate is fine. */
function priceUsd(model: string, inTok: number, outTok: number, cacheTok: number): number {
  const m = model.toLowerCase();
  let pin = 3, pout = 15; // sonnet
  if (m.includes("opus")) { pin = 5; pout = 25; }
  else if (m.includes("haiku")) { pin = 1; pout = 5; }
  return ((inTok * pin) + (outTok * pout) + (cacheTok * pin * 0.1)) / 1_000_000;
}

async function post(body: string, key: string): Promise<Response> {
  const headers = { "content-type": "application/json", "x-api-key": key, "anthropic-version": VERSION };
  let last: unknown;
  for (let i = 0; i <= 2; i++) {
    try {
      const res = await fetch(API, { method: "POST", headers, body });
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      last = new Error(`status ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw last ?? new Error("anthropic post failed");
}

export async function anthropicReply(
  modelName: string | undefined,
  systemInstruction: string,
  contents: GeminiContent[],
  toolset?: Toolset,
  meter?: MeterCtx,
): Promise<GeminiReply> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    console.warn("[anthropic] ANTHROPIC_API_KEY not set — skipping reply (inbound still logged)");
    return { text: null, toolsUsed: [] };
  }
  const model = modelName || DEFAULT_MODEL;
  let tools = toolset && toolset.declarations.length > 0
    ? toolset.declarations.map((d) => ({
      name: d.name,
      description: d.description,
      input_schema: d.parameters ?? { type: "object", properties: {} },
    }))
    : undefined;

  const messages = toMessages(contents);
  const toolsUsed: string[] = [];
  let inTok = 0, outTok = 0, cacheTok = 0, calls = 0;

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const body = JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemInstruction,
        messages,
        ...(tools ? { tools } : {}),
      });
      const res = await post(body, key);
      if (!res.ok) {
        console.error(`[anthropic] ${res.status}: ${await res.text()}`);
        // A tool schema Claude won't accept fails the whole request → drop tools and
        // retry once (before any tool has run) so it still answers from knowledge.
        if (tools && iter === 0) {
          tools = undefined;
          continue;
        }
        return { text: null, toolsUsed };
      }
      // deno-lint-ignore no-explicit-any
      const j: any = await res.json();
      calls++;
      inTok += num(j?.usage?.input_tokens) + num(j?.usage?.cache_creation_input_tokens);
      cacheTok += num(j?.usage?.cache_read_input_tokens);
      outTok += num(j?.usage?.output_tokens);

      const content: Blk[] = j?.content ?? [];
      const toolUses = content.filter((b) => b.type === "tool_use");
      if (j?.stop_reason !== "tool_use" || toolUses.length === 0) {
        const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim() || null;
        return { text, toolsUsed };
      }
      if (!toolset) return { text: null, toolsUsed };

      // Execute the model's tool calls (parallel), then feed results back.
      messages.push({ role: "assistant", content });
      const results = await Promise.all(toolUses.map(async (tu) => {
        toolsUsed.push(tu.name);
        const r = await toolset.execute(tu.name, tu.input ?? {});
        return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(r) } as Blk;
      }));
      messages.push({ role: "user", content: results });
    }
    // Out of tool rounds — final pass with no tools so it answers from what it has.
    const finalRes = await post(
      JSON.stringify({ model, max_tokens: 1024, system: systemInstruction, messages }),
      key,
    );
    if (!finalRes.ok) return { text: null, toolsUsed };
    // deno-lint-ignore no-explicit-any
    const fj: any = await finalRes.json();
    calls++;
    inTok += num(fj?.usage?.input_tokens);
    outTok += num(fj?.usage?.output_tokens);
    const fc: Blk[] = fj?.content ?? [];
    return { text: fc.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim() || null, toolsUsed };
  } catch (err) {
    console.error("[anthropic] error:", err);
    return { text: null, toolsUsed };
  } finally {
    if (meter && calls > 0) {
      await recordUsage(meter, "anthropic", model, { inputTokens: inTok, outputTokens: outTok, cachedTokens: cacheTok, calls }, priceUsd(model, inTok, outTok, cacheTok));
    }
  }
}
