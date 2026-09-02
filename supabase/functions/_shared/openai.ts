// OpenAI adapter — same contract as gemini.generateReply (Chat Completions +
// function calling). Raw HTTP (Deno). Platform key: OPENAI_API_KEY. Fail-open
// (text:null) like the Gemini path so a missing key never breaks intake.
import type { Toolset } from "./tools.ts";
import type { GeminiContent, GeminiReply } from "./gemini.ts";
import { recordUsage, type MeterCtx } from "./meter.ts";

const API = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOOL_ITERATIONS = 6;

// deno-lint-ignore no-explicit-any
type Msg = Record<string, any>;

function num(v: unknown): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/** GeminiContent[] → OpenAI chat messages (text, or a parts array when an image
 *  rides the user turn). */
function toMessages(contents: GeminiContent[]): Msg[] {
  const out: Msg[] = [];
  for (const c of contents) {
    const role = c.role === "model" ? "assistant" : "user";
    const hasImage = c.parts.some((p) => p.inlineData);
    if (hasImage && role === "user") {
      // deno-lint-ignore no-explicit-any
      const parts: any[] = [];
      for (const p of c.parts) {
        if (p.text) parts.push({ type: "text", text: p.text });
        else if (p.inlineData) {
          parts.push({ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
        }
      }
      if (parts.length) out.push({ role, content: parts });
    } else {
      const text = c.parts.filter((p) => p.text).map((p) => p.text).join("\n");
      if (text) out.push({ role, content: text });
    }
  }
  return out;
}

function priceUsd(model: string, inTok: number, outTok: number): number {
  const m = model.toLowerCase();
  let pin = 0.15, pout = 0.6; // gpt-4o-mini
  if (m.includes("4o") && !m.includes("mini")) { pin = 2.5; pout = 10; }
  return ((inTok * pin) + (outTok * pout)) / 1_000_000;
}

async function post(body: string, key: string): Promise<Response> {
  const headers = { "content-type": "application/json", "authorization": `Bearer ${key}` };
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
  throw last ?? new Error("openai post failed");
}

export async function openaiReply(
  modelName: string | undefined,
  systemInstruction: string,
  contents: GeminiContent[],
  toolset?: Toolset,
  meter?: MeterCtx,
): Promise<GeminiReply> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) {
    console.warn("[openai] OPENAI_API_KEY not set — skipping reply (inbound still logged)");
    return { text: null, toolsUsed: [] };
  }
  const model = modelName || DEFAULT_MODEL;
  let tools = toolset && toolset.declarations.length > 0
    ? toolset.declarations.map((d) => ({
      type: "function",
      function: { name: d.name, description: d.description, parameters: d.parameters ?? { type: "object", properties: {} } },
    }))
    : undefined;

  const messages: Msg[] = [{ role: "system", content: systemInstruction }, ...toMessages(contents)];
  const toolsUsed: string[] = [];
  let inTok = 0, outTok = 0, calls = 0;

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const body = JSON.stringify({
        model,
        max_tokens: 1024,
        messages,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
      });
      const res = await post(body, key);
      if (!res.ok) {
        console.error(`[openai] ${res.status}: ${await res.text()}`);
        if (tools && iter === 0) {
          tools = undefined;
          continue;
        }
        return { text: null, toolsUsed };
      }
      // deno-lint-ignore no-explicit-any
      const j: any = await res.json();
      calls++;
      inTok += num(j?.usage?.prompt_tokens);
      outTok += num(j?.usage?.completion_tokens);

      const msg = j?.choices?.[0]?.message;
      const toolCalls = msg?.tool_calls ?? [];
      if (!msg || toolCalls.length === 0) {
        const text = (msg?.content ?? "").trim() || null;
        return { text, toolsUsed };
      }
      if (!toolset) return { text: null, toolsUsed };

      messages.push(msg); // assistant turn carrying the tool_calls
      const results = await Promise.all(toolCalls.map(async (tc: Msg) => {
        toolsUsed.push(tc.function?.name);
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* bad JSON → {} */ }
        const r = await toolset.execute(tc.function?.name, args);
        return { role: "tool", tool_call_id: tc.id, content: JSON.stringify(r) };
      }));
      messages.push(...results);
    }
    const finalRes = await post(JSON.stringify({ model, max_tokens: 1024, messages }), key);
    if (!finalRes.ok) return { text: null, toolsUsed };
    // deno-lint-ignore no-explicit-any
    const fj: any = await finalRes.json();
    calls++;
    inTok += num(fj?.usage?.prompt_tokens);
    outTok += num(fj?.usage?.completion_tokens);
    const text = (fj?.choices?.[0]?.message?.content ?? "").trim() || null;
    return { text, toolsUsed };
  } catch (err) {
    console.error("[openai] error:", err);
    return { text: null, toolsUsed };
  } finally {
    if (meter && calls > 0) {
      await recordUsage(meter, "openai", model, { inputTokens: inTok, outputTokens: outTok, cachedTokens: 0, calls }, priceUsd(model, inTok, outTok));
    }
  }
}
