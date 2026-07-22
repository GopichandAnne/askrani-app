// Gemini client + function-calling loop — Bot Phases 2–3.
//
// AI Studio key path (GEMINI_API_KEY). Implicit caching is automatic on 2.5
// models for repeated prefixes: systemInstruction + tool declarations are stable
// (cacheable prefix); retrieved tool results land in the volatile contents.
//
// The loop: call the model; if it emits functionCall part(s), execute them (in
// parallel), append the model turn + a role:"user" functionResponse turn, and
// call again — bounded by MAX_TOOL_ITERATIONS. In the generativelanguage v1beta
// API, Content.role must be "user" or "model", so tool results go back as a
// "user" turn carrying functionResponse parts (NOT a "function" role — that's a
// Vertex-ism).
//
// Best-effort: missing key or a failed call returns { text: null } so intake
// never breaks and the bot stays quiet.

import type { Toolset } from "./tools.ts";

// `-latest` alias tracks the current flash so a model retirement (e.g. Google
// pulling gemini-2.5-flash) can't 404 the whole bot. Override with GEMINI_MODEL.
const DEFAULT_MODEL = "gemini-flash-latest";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Multi-line orders need several rounds: search, search, add, add, view_cart.
// Four was too few — wholesale carts ("12 beakers and 2 cases of cones") ran out
// mid-order and the turn died with no reply after the items were already added.
const MAX_TOOL_ITERATIONS = 6;

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}
export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string }; // base64 media (e.g. a customer's photo)
  functionCall?: FunctionCall;
  functionResponse?: { name: string; response: Record<string, unknown> };
}
export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiReply {
  text: string | null;
  toolsUsed: string[];
}

/** POST with retry on transient failures (network error, 429, 5xx). */
async function fetchWithRetry(url: string, body: string): Promise<Response> {
  const MAX = 2;
  let last: unknown;
  for (let i = 0; i <= MAX; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok || (res.status !== 429 && res.status < 500)) return res; // done or non-retryable
      last = res;
      console.warn(`[gemini] transient ${res.status}, retry ${i + 1}/${MAX}`);
    } catch (e) {
      last = e;
      console.warn(`[gemini] fetch error, retry ${i + 1}/${MAX}`);
    }
    if (i < MAX) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  if (last instanceof Response) return last;
  throw last;
}

/**
 * One-shot structured generation: returns a parsed JSON object matching the
 * given responseSchema (Gemini JSON mode). null on no-key/failure/parse error.
 * Used for owner-facing tasks like natural-language config parsing — never the
 * customer chat loop.
 */
export async function generateStructured(
  systemInstruction: string,
  userText: string,
  responseSchema?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    console.warn("[gemini] GEMINI_API_KEY not set — structured generation skipped");
    return null;
  }
  const model = Deno.env.get("GEMINI_MODEL") ?? DEFAULT_MODEL;
  const url = `${API_BASE}/models/${model}:generateContent?key=${key}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.2,
      // Thinking tokens count against this budget on flash; keep it generous so a
      // multi-part plan's JSON isn't truncated (which would drop the whole plan).
      // Also don't set thinkingBudget:0 — that can yield empty output.
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      // A rigid responseSchema makes flash emit minimal conformant output and
      // ignore few-shot structure — rely on JSON mode + the example instead.
      ...(responseSchema ? { responseSchema } : {}),
    },
  });
  try {
    const res = await fetchWithRetry(url, body);
    if (!res.ok) {
      console.error(`[gemini] structured ${res.status}: ${await res.text()}`);
      return null;
    }
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json();
    const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
      // deno-lint-ignore no-explicit-any
      .map((p: any) => p.text ?? "").join("");
    if (!text.trim()) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    console.error("[gemini] structured error:", e);
    return null;
  }
}

/**
 * Structured extraction from a MEDIA file (PDF, image) — Gemini reads it
 * natively. Returns a parsed JSON object or null. Used by document-parsing
 * connectors (e.g. parse-resume) for binary résumés.
 */
export async function generateStructuredFromMedia(
  systemInstruction: string,
  mime: string,
  dataBase64: string,
): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("GEMINI_MODEL") ?? DEFAULT_MODEL;
  const url = `${API_BASE}/models/${model}:generateContent?key=${key}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: mime, data: dataBase64 } },
        { text: "Extract the fields from this document." },
      ],
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" },
  });
  try {
    const res = await fetchWithRetry(url, body);
    if (!res.ok) {
      console.error(`[gemini] media ${res.status}: ${await res.text()}`);
      return null;
    }
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json();
    const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
      // deno-lint-ignore no-explicit-any
      .map((p: any) => p.text ?? "").join("");
    if (!text.trim()) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    console.error("[gemini] media error:", e);
    return null;
  }
}

/**
 * Generate a reply, running the tool loop if a toolset is given. Returns the
 * final text (null on no-key/failure) and the ordered list of tools invoked.
 */
export async function generateReply(
  systemInstruction: string,
  contents: GeminiContent[],
  toolset?: Toolset,
): Promise<GeminiReply> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    console.warn("[gemini] GEMINI_API_KEY not set — skipping reply (inbound still logged)");
    return { text: null, toolsUsed: [] };
  }
  const model = Deno.env.get("GEMINI_MODEL") ?? DEFAULT_MODEL;
  const url = `${API_BASE}/models/${model}:generateContent?key=${key}`;
  const tools = toolset && toolset.declarations.length > 0
    ? [{ functionDeclarations: toolset.declarations }]
    : undefined;

  const convo: GeminiContent[] = [...contents];
  const toolsUsed: string[] = [];

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: convo,
        ...(tools ? { tools } : {}),
        // Minimize "thinking": it consumes the output budget and adds latency we
        // don't need for a grocery assistant. NOTE: current gemini-flash-latest
        // models REJECT thinkingBudget:0 (400 INVALID_ARGUMENT) — thinking can no
        // longer be fully disabled — so use the minimum accepted budget (128).
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 128 },
        },
      });
      const res = await fetchWithRetry(url, body);
      if (!res.ok) {
        console.error(`[gemini] ${res.status}: ${await res.text()}`);
        return { text: null, toolsUsed };
      }
      // deno-lint-ignore no-explicit-any
      const json: any = await res.json();
      const cached = json?.usageMetadata?.cachedContentTokenCount;
      if (cached) console.log(`[gemini] cache hit: ${cached} tokens`);

      const content = json?.candidates?.[0]?.content;
      const parts: GeminiPart[] = content?.parts ?? [];
      const calls = parts.filter((p): p is GeminiPart & { functionCall: FunctionCall } =>
        !!p.functionCall
      );

      if (calls.length === 0) {
        const text = parts.map((p) => p.text ?? "").join("").trim() || null;
        return { text, toolsUsed };
      }

      // Execute the model's tool calls (parallel), then feed results back.
      if (!toolset) return { text: null, toolsUsed }; // model called a tool with none offered
      convo.push({ role: "model", parts });
      const results = await Promise.all(
        calls.map(async (c) => {
          toolsUsed.push(c.functionCall.name);
          const response = await toolset.execute(
            c.functionCall.name,
            c.functionCall.args ?? {},
          );
          return { name: c.functionCall.name, response };
        }),
      );
      convo.push({
        role: "user",
        parts: results.map((r) => ({
          functionResponse: { name: r.name, response: r.response },
        })),
      });
    }
    // Out of tool rounds. The side effects already happened (items are in the
    // cart), so failing here would tell the customer "something went wrong"
    // about work that actually succeeded. Ask once more with no tools offered,
    // which forces the model to answer from what it has.
    console.warn(`[gemini] hit MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}) — final pass without tools`);
    const finalRes = await fetchWithRetry(
      url,
      JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: convo,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 128 },
        },
      }),
    );
    if (!finalRes.ok) {
      console.error(`[gemini] final pass ${finalRes.status}: ${await finalRes.text()}`);
      return { text: null, toolsUsed };
    }
    // deno-lint-ignore no-explicit-any
    const finalJson: any = await finalRes.json();
    const finalParts: GeminiPart[] = finalJson?.candidates?.[0]?.content?.parts ?? [];
    return {
      text: finalParts.map((p) => p.text ?? "").join("").trim() || null,
      toolsUsed,
    };
  } catch (err) {
    console.error("[gemini] error:", err);
    return { text: null, toolsUsed };
  }
}
