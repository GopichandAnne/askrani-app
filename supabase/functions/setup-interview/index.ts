// setup-interview — the Setup Copilot's brain (one interview turn).
//
// Rani warmly interviews a small-business owner (in THEIR language, one plain
// question at a time, offering tap-able chips) and, when it has enough, writes the
// whole store config itself. No forms, no prompt-engineering — the owner just talks
// about their business. Stateless: the client sends the running transcript each
// turn; we return Rani's next message + chips, whether we're done, and (when done)
// the config the control panel provisions with (createMyStore).
//
// PHASE 1 — universal auto-fill. Instead of interrogating the owner for every
// detail, Rani asks for ONE identifier — a street address (local storefront) or a
// website (online/product company) — then emits a `detect` signal. The client runs
// the detect-business lookup (Google Place + hours, or a homepage read) and feeds
// the result back on the next turn as `detected`, so Rani CONFIRMS the specifics
// instead of asking them cold. A miss just falls back to asking normally.
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

THE FLOW (follow this order):
1. Ask the business name.
2. Ask what kind of business it is, so you can tell if they serve customers at a PHYSICAL location or are an ONLINE / software / B2B company. Offer chips.
3. Ask for the ONE identifier that lets you look them up automatically:
   - Physical storefront (shop, restaurant, salon, grocery, etc.) → ask for their STREET ADDRESS.
   - Online / software / product / B2B company → ask for their WEBSITE.
   When the owner gives you that address or website, DO NOT ask anything else in that turn. Instead set "done": false, write a short warm holding line like "Perfect — give me a moment to look you up…", and set "detect" to {"kind": "local" (address) or "online" (website), "query": "<exactly what they gave you>", "name": "<business name if known>"}.
4. On the NEXT turn you will be given a [DETECTED] block with what the lookup found:
   - If it found the business, ACKNOWLEDGE the specifics warmly and CONFIRM them in one message — e.g. "Found you! <name> at <address>, open <hours>. Does that look right?" Offer chips like "Yes, that's right" and "Something's off". Trust these facts; don't re-ask for hours/address you were just shown.
   - If the block includes DRAFT STORE KNOWLEDGE (departments, services, likely questions), tell the owner you've also set up a starting point for them and SUMMARIZE it in a friendly, compact way (e.g. "I also set you up to answer about your departments — produce, frozen, spices… — plus common questions like fresh sabzi and catering."). Then ask, in the SAME message, one simple confirm: "Want to add or change anything, or shall I go with this?" Offer chips like "Looks good" and "Add something". Keep it to a few lines — do NOT dump the whole list.
   - If it found NOTHING (or the owner says something's off), don't dwell on it — just continue asking normally.
5. Fill only the REMAINING gaps. If the draft knowledge already covered what they sell/offer, do NOT re-interrogate — just confirm the tone they want (friendly vs professional) and anything the owner wants to add. Infer sensible defaults for anything they don't know.
5b. FOR ONLINE / PRODUCT / B2B COMPANIES (a DRAFT PRODUCT KNOWLEDGE block was provided): after confirming the product facts, offer to set up LEAD CAPTURE — tell them Rani can capture the lead types the site suggested (e.g. "demo requests, sales/pricing enquiries, support questions, job applicants") and ask which they want. Put the agreed keys (any of: demo, quote, support, careers) in config.captureTypes. Fold the features, integrations, pricing and prospect Q&A into storePrompt so Rani answers prospects from day one.
6. When you have enough (often just the confirm + tone after the lookup), set "done": true, write a warm closing message, and produce "config".

In "config":
- "businessType" MUST be one of: grocery, convenience, liquor, hardware, pet, bookstore, nursery, restaurant, hospitality, rental, realtor, wholesale, church, other. Pick the closest using the detected category/vertical when available.
- "personality": 2-3 sentences describing how Rani should talk to THIS business's customers (reflect their chosen tone), in ENGLISH (the assistant translates per customer at runtime).
- "storePrompt": the ENGLISH knowledge the assistant answers customers from. FOLD IN every useful detected fact — address, opening hours, phone, what they sell/offer (or the online company's summary + main offerings), ordering, delivery/pickup, and any policy mentioned. When DRAFT STORE KNOWLEDGE was provided, include ALL of it: the departments/sections (so the bot can direct shoppers), the services, what they're known for, and the likely customer questions with their answers (write these out as Q&A the assistant can use). Be specific and thorough — this is the bot's brain from day one.
- "suggestionChips": 3-4 short example things a CUSTOMER might tap to start (English), fitting this business.
- "greeting": a short friendly opening line the assistant says to customers (English).
- Include "businessName", "website" and "address" when known, and "ownerName"/"email" only if the owner gave them.

Respond with ONLY a JSON object of this exact shape (no markdown, no code fences):
{"reply": string, "chips": string[], "done": boolean, "detect"?: {"kind": "local"|"online", "query": string, "name"?: string}, "config"?: {"businessName": string, "businessType": string, "website"?: string, "address"?: string, "ownerName"?: string, "email"?: string, "personality": string, "storePrompt": string, "suggestionChips": string[], "greeting": string, "captureTypes"?: string[]}}

"captureTypes" (online/product/B2B only): any of "demo", "quote", "support", "careers" — the lead types the owner agreed to capture. Omit for local storefronts.

If the transcript is empty (first turn), warmly welcome them and ask for the business name, with no chips.`;

/** Render the detect result into a compact block the model confirms from. */
function formatDetected(d: Record<string, unknown> | null): string {
  if (!d || d.found === false) {
    return "\n\n[DETECTED] The automatic lookup found nothing usable. Don't mention the lookup failed — just keep interviewing normally to fill the gaps.";
  }
  const lines: string[] = [];
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (s(d.name)) lines.push(`Name: ${s(d.name)}`);
  if (s(d.category)) lines.push(`Category: ${s(d.category)}`);
  if (s(d.vertical)) lines.push(`Vertical: ${s(d.vertical)}`);
  if (s(d.address)) lines.push(`Address: ${s(d.address)}`);
  if (s(d.website)) lines.push(`Website: ${s(d.website)}`);
  if (s(d.phone)) lines.push(`Phone: ${s(d.phone)}`);
  if (Array.isArray(d.hours) && d.hours.length) lines.push(`Hours:\n  ${d.hours.map(String).join("\n  ")}`);
  if (typeof d.rating === "number") lines.push(`Rating: ${d.rating}★ (${d.reviews ?? 0} reviews)`);
  if (s(d.summary)) lines.push(`What they do: ${s(d.summary)}`);
  if (Array.isArray(d.offerings) && d.offerings.length) lines.push(`Main offerings: ${d.offerings.map(String).join(", ")}`);

  // P3 — the product/B2B company draft (from the website).
  const bz = d.b2b as Record<string, unknown> | undefined;
  if (bz && typeof bz === "object") {
    const bl: string[] = [];
    if (Array.isArray(bz.features) && bz.features.length) bl.push(`Key features: ${bz.features.map(String).join(", ")}`);
    if (Array.isArray(bz.integrations) && bz.integrations.length) bl.push(`Integrations: ${bz.integrations.map(String).join(", ")}`);
    if (Array.isArray(bz.pricingTiers) && bz.pricingTiers.length) bl.push(`Pricing/plans: ${bz.pricingTiers.map(String).join(", ")}`);
    if (Array.isArray(bz.faqs) && bz.faqs.length) {
      const faqs = (bz.faqs as { q?: unknown; a?: unknown }[]).filter((f) => s(f?.q) && s(f?.a)).map((f) => `    • ${s(f.q)} → ${s(f.a)}`);
      if (faqs.length) bl.push(`Likely prospect questions (with draft answers):\n${faqs.join("\n")}`);
    }
    if (Array.isArray(bz.captureTypes) && bz.captureTypes.length) bl.push(`Leads worth capturing: ${bz.captureTypes.map(String).join(", ")}`);
    if (bl.length) lines.push(`\nDRAFT PRODUCT KNOWLEDGE (built from their website — present as a draft to confirm; put the product facts + Q&A into storePrompt, and set config.captureTypes from the capture list they agree to):\n${bl.join("\n")}`);
  }

  // Lever A — a draft knowledge base built from the business's public footprint.
  const k = d.knowledge as Record<string, unknown> | undefined;
  if (k && typeof k === "object") {
    const kl: string[] = [];
    if (Array.isArray(k.departments) && k.departments.length) kl.push(`Departments/sections: ${k.departments.map(String).join(", ")}`);
    if (Array.isArray(k.services) && k.services.length) kl.push(`Services: ${k.services.map(String).join(", ")}`);
    if (Array.isArray(k.highlights) && k.highlights.length) kl.push(`Known for: ${k.highlights.map(String).join(", ")}`);
    if (Array.isArray(k.faqs) && k.faqs.length) {
      const faqs = (k.faqs as { q?: unknown; a?: unknown }[])
        .filter((f) => s(f?.q) && s(f?.a))
        .map((f) => `    • ${s(f.q)} → ${s(f.a)}`);
      if (faqs.length) kl.push(`Likely customer questions (with draft answers):\n${faqs.join("\n")}`);
    }
    if (kl.length) lines.push(`\nDRAFT STORE KNOWLEDGE (built from their website + reviews — present as a draft to confirm, then put it ALL into storePrompt):\n${kl.join("\n")}`);
  }
  return `\n\n[DETECTED] The automatic lookup found this — confirm it warmly with the owner and reuse it (don't re-ask for these):\n${lines.join("\n")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { messages?: { role?: string; text?: string }[]; email?: string; detected?: Record<string, unknown> | null; site?: string };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const transcript = messages.length === 0
    ? "[The conversation is just starting — no messages yet.]"
    : messages.map((m) => `${m.role === "owner" ? "Owner" : "Rani"}: ${String(m.text ?? "")}`).join("\n");
  const known = body.email ? `\n\n[The owner's account email is already ${body.email} — don't ask for it again.]` : "";
  const detected = body.detected !== undefined ? formatDetected(body.detected) : "";
  // Grader hand-off: the owner came from our website grader, so we already have
  // their site — treat them as online and detect from it instead of asking again.
  const site = typeof body.site === "string" ? body.site.trim() : "";
  const siteHint = site
    ? `\n\n[The owner arrived from our website grader, which just graded the site: ${site}. Ask their business name first. IF the name they give is the SAME company as ${site}, treat them as an ONLINE / software / product company and run detect (kind "online", query "${site}") WITHOUT asking for their website — we already have it. BUT if the name they give is clearly a DIFFERENT business than ${site} (a different company name), IGNORE this grader site entirely and follow the normal flow: ask for their own website or address and detect from what THEY give you — never detect ${site} for a business it doesn't belong to.]`
    : "";

  const out = await generateStructured(SYS, `${transcript}${known}${siteHint}${detected}\n\nWrite Rani's next turn as JSON.`);
  if (!out || typeof out.reply !== "string") {
    return json({ reply: "Sorry, I didn't catch that — could you say it once more?", chips: [], done: false });
  }

  // A detect signal is only valid mid-interview (never on the same turn we finish).
  const det = out.detect && typeof out.detect === "object" && !out.done
    ? {
        kind: (out.detect as Record<string, unknown>).kind === "online" ? "online" : "local",
        query: String((out.detect as Record<string, unknown>).query ?? "").trim(),
        name: String((out.detect as Record<string, unknown>).name ?? "").trim() || undefined,
      }
    : null;

  return json({
    reply: out.reply,
    chips: Array.isArray(out.chips) ? out.chips.slice(0, 5).map(String) : [],
    done: out.done === true,
    detect: det && det.query ? det : null,
    config: out.done === true ? (out.config ?? null) : null,
  });
});
