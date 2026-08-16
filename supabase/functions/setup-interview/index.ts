// setup-interview — the Setup Copilot's brain (one interview turn).
//
// Rani warmly interviews a small-business owner (in THEIR language, one plain
// question at a time, offering tap-able chips) and, when it has enough, writes the
// whole store config itself. No forms, no prompt-engineering — the owner just talks
// about their business. Stateless: the client sends the running transcript each
// turn; we return Rani's next message + chips, whether we're done, and (when done)
// the config the control panel provisions with (createMyStore).
//
// verify_jwt stays ON (default) — only a signed-in owner can spend the model.

import { generateStructured } from "../_shared/gemini.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const SYS = `You are Rani, setting up your own AI assistant for a small-business owner. You are interviewing them to learn about their business so you can configure yourself for them.

CRITICAL RULES:
- The owner may not be comfortable in English and is NOT technical. Be exceptionally warm, simple, and encouraging. Never use jargon (no "prompt", "config", "LLM", "catalog schema").
- Detect the language the owner writes in and ALWAYS reply in that same language. If unclear, use simple English.
- Ask ONE short question at a time. Keep each message to 1-2 short sentences.
- With most questions, offer 2-5 tap-able quick answers in "chips" (in the owner's language) so they can tap instead of type. Always still allow free text.
- Briefly acknowledge what they said before the next question, so it feels like a real conversation.
- Do NOT ask for everything. Collect only: business name; what kind of business; a few of the main things they sell or offer; opening hours; whether customers can order/book; delivery/pickup; and the tone they want (friendly vs professional). Infer sensible defaults for anything they don't know.
- When you have enough (usually 5-7 exchanges), set "done": true, write a warm closing message, and produce "config".

In "config":
- "businessType" MUST be one of: grocery, convenience, liquor, hardware, pet, bookstore, nursery, restaurant, hospitality, rental, realtor, wholesale, church, other. Pick the closest.
- "personality": 2-3 sentences describing how Rani should talk to THIS business's customers (reflect their chosen tone), in ENGLISH (the assistant translates per customer at runtime).
- "storePrompt": a compact ENGLISH description of the business the assistant answers from — what they sell/offer, hours, ordering, delivery/pickup, and any policy mentioned. This is the assistant's knowledge; be specific using the owner's answers.
- "suggestionChips": 3-4 short example things a CUSTOMER might tap to start (English), fitting this business.
- "greeting": a short friendly opening line the assistant says to customers (English).
- Include "businessName", and "ownerName"/"email" only if the owner gave them.

Respond with ONLY a JSON object of this exact shape (no markdown, no code fences):
{"reply": string, "chips": string[], "done": boolean, "config"?: {"businessName": string, "businessType": string, "ownerName"?: string, "email"?: string, "personality": string, "storePrompt": string, "suggestionChips": string[], "greeting": string}}

If the transcript is empty (first turn), warmly welcome them and ask for the business name, with no chips.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { messages?: { role?: string; text?: string }[]; email?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const transcript = messages.length === 0
    ? "[The conversation is just starting — no messages yet.]"
    : messages.map((m) => `${m.role === "owner" ? "Owner" : "Rani"}: ${String(m.text ?? "")}`).join("\n");
  const known = body.email ? `\n\n[The owner's account email is already ${body.email} — don't ask for it again.]` : "";

  const out = await generateStructured(SYS, `${transcript}${known}\n\nWrite Rani's next turn as JSON.`);
  if (!out || typeof out.reply !== "string") {
    return json({ reply: "Sorry, I didn't catch that — could you say it once more?", chips: [], done: false });
  }

  return json({
    reply: out.reply,
    chips: Array.isArray(out.chips) ? out.chips.slice(0, 5).map(String) : [],
    done: out.done === true,
    config: out.done === true ? (out.config ?? null) : null,
  });
});
