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

const DEFAULT_MODEL = "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_TOOL_ITERATIONS = 4;

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}
export interface GeminiPart {
  text?: string;
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
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
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
    console.warn(`[gemini] hit MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS})`);
    return { text: null, toolsUsed };
  } catch (err) {
    console.error("[gemini] error:", err);
    return { text: null, toolsUsed };
  }
}
