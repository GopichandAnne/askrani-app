// Turn analytics — Bot Phase 3d. Classifies a customer turn into intent /
// language / sentiment / items for the Dashboard. Runs AFTER the reply is sent
// (best-effort), so it never adds latency to the customer's reply. Falls back to
// the script-based language guess if the key is missing or the call fails.

import { detectLanguage } from "./prompt.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";

export async function classifyTurn(
  userMessage: string,
  assistantReply: string,
): Promise<Record<string, unknown>> {
  const fallback = { language: detectLanguage(userMessage) };
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return fallback;
  const model = Deno.env.get("GEMINI_MODEL") ?? DEFAULT_MODEL;

  const prompt =
    "Classify this WhatsApp message from a customer to a grocery-store assistant. " +
    "language = the actual language the customer wrote in (e.g. English, Hindi, " +
    "Telugu, Tamil), detecting romanized text too. items = specific product names " +
    "mentioned (empty if none).\n" +
    `Customer message: ${userMessage}\n` +
    `Assistant reply: ${assistantReply}`;

  try {
    const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 600,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              intent: {
                type: "string",
                enum: ["navigation", "product_search", "inquiry", "order", "feedback", "escalation", "greeting", "other"],
              },
              language: { type: "string" },
              sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
              items: { type: "array", items: { type: "string" } },
            },
            required: ["intent", "language", "sentiment", "items"],
          },
        },
      }),
    });
    if (!res.ok) return fallback;
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
