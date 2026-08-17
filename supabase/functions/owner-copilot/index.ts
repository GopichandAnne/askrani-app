// owner-copilot — the always-on in-panel Setup & Help Copilot.
//
// The owner chats with Rani to (a) get help ("how do I get my QR?", "what are
// credits?") and (b) CHANGE their store by natural language ("make the greeting
// friendlier", "we're closed Sundays now", "we do delivery too"). Rani answers and
// EXECUTES config edits through owner-scoped tools — so a non-technical owner never
// touches a settings screen. Same function-calling engine as the customer bot, with
// an owner toolset. Metered against the store's wallet (kind owner_copilot).
//
// Auth: verify_jwt on (default) — the platform validates the JWT before we run; we
// read the user from it and confirm they're staff of the store. Config edits require
// the OWNER role.

import { serviceClient } from "../_shared/supabase.ts";
import { generateReply, type GeminiContent } from "../_shared/gemini.ts";
import type { Toolset, FunctionDeclaration } from "../_shared/tools.ts";
import { reindexKnowledge, syncSavedQaToIndex } from "../_shared/knowledge.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// The product knowledge the copilot answers "how do I / what is" from. Kept short
// and plain — this is what a non-technical owner needs, in the copilot's words.
const PRODUCT_HELP = `About Ask Rani (answer owner questions from this):
- Rani is the AI assistant that serves this store's customers on a web page/QR link (works today) and on WhatsApp (see below).
- Catalog: add what you sell under Catalog — you can snap a photo of a menu/price list and Rani reads it in. Prices/photos live there.
- Agent: your bot's personality, greeting and knowledge — but you can just tell ME to change these.
- Web Chat / QR: under "Web Chat" you get a shareable link + a printable QR customers scan to chat with Rani.
- Members, Campaigns, Redemptions, Post-reviews: loyalty + "promote & earn" (customers share/post for store credit).
- Credits: usage runs on credits; you started with 150 free. Monitoring competitors (Ask Rani Insights) also uses the same credits.
- Going live on WhatsApp is a guided, DONE-FOR-YOU setup (a person helps you connect your number) — offer to note their interest so the team reaches out; don't tell them to do it themselves.`;

function sys(storeName: string, isOwner: boolean): string {
  return `You are Rani, the friendly in-app assistant helping the OWNER/STAFF of "${storeName}" run their store.

You do TWO things:
1) ANSWER their questions about the product and their store, simply and warmly.
2) CHANGE their store settings when they ask, by calling the tools — then confirm in plain words what you changed.

RULES:
- Detect the language they write in and reply in it. Be warm, simple, non-technical (no jargon).
- Before reading or changing anything, you may call read_settings to see the current state.
- For any CHANGE, call the right tool, then tell them clearly what's now set. For a big or destructive change, confirm first.
- ${isOwner ? "This user is the OWNER — they can change settings." : "This user is STAFF, not the owner — you can answer questions but you CANNOT change settings; if they ask to change something, kindly say only the owner can."}
- If they want to add products, guide them to Catalog (they can snap a photo of their menu) — you don't edit the catalog yourself.
- Keep replies short.

${PRODUCT_HELP}`;
}

const EDIT_KEYS: Record<string, string> = {
  business_info: "store_prompt", // what they sell, hours, delivery, policies (the bot's knowledge)
  persona: "personality",
  hours: "store_hours",
};

const DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "read_settings",
    description: "Read the store's current key settings (name, type, WhatsApp status, whether ordering/catalog are on, business info, hours, persona). Use before answering 'what is my…' or before changing something.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_business_info",
    description: "Set/replace the description the assistant answers customers from — what the store sells/offers, delivery/pickup, and any policy. Use natural sentences.",
    parameters: { type: "object", properties: { text: { type: "string", description: "The full business description in natural language." } }, required: ["text"] },
  },
  {
    name: "set_hours",
    description: "Set the store's opening hours as plain text, e.g. 'Mon-Sat 9am-9pm, closed Sunday'.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "set_persona",
    description: "Set how Rani talks to this store's customers (tone/personality), e.g. warmer, more professional, more playful.",
    parameters: { type: "object", properties: { text: { type: "string", description: "2-3 sentences describing the tone/persona." } }, required: ["text"] },
  },
  {
    name: "set_feature",
    description: "Turn a store feature on or off.",
    parameters: {
      type: "object",
      properties: {
        feature: { type: "string", enum: ["ordering", "catalog"], description: "'ordering' lets customers place orders; 'catalog' shows products/prices." },
        enabled: { type: "boolean" },
      },
      required: ["feature", "enabled"],
    },
  },
  {
    name: "note_whatsapp_interest",
    description: "Record that the owner wants help going live on WhatsApp (the done-for-you setup). Call this when they express interest.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_open_questions",
    description: "List real questions customers recently asked Rani that it could NOT answer (they aren't in the store's knowledge yet), most-asked first. Each has a short `code`. Use it to show the owner what shoppers want, then help them fill the gaps.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "answer_customer_question",
    description: "Save the owner's answer to one of the open customer questions from list_open_questions. Pass its `code` and the `answer` in the store's voice. This makes Rani answer that question automatically from now on, and clears it from the open list.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "The code of the question from list_open_questions, e.g. 'g1'." },
        answer: { type: "string", description: "The answer, in plain language — what Rani should tell customers who ask this." },
      },
      required: ["code", "answer"],
    },
  },
];

/** Normalize a question for grouping near-identical asks together. */
const normQ = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// deno-lint-ignore no-explicit-any
type Db = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // The platform already verified the JWT (verify_jwt on); read the user from it.
  // JWT segments are base64URL (─/_ , no padding) — plain atob() throws on those,
  // so normalise to base64 first.
  let userId = "";
  try {
    const seg = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").split(".")[1] ?? "";
    let s = seg.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    userId = JSON.parse(atob(s)).sub ?? "";
  } catch { /* ignore */ }
  if (!userId) return json({ error: "unauthorized" }, 401);

  let body: { storeSlug?: string; messages?: { role?: string; text?: string }[] };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const slug = String(body.storeSlug ?? "").trim().toLowerCase();
  if (!slug) return json({ error: "storeSlug required" }, 400);

  const db: Db = serviceClient();
  const { data: store } = await db.from("stores").select("id, slug, store_display_name, business_type, whatsapp_status").eq("slug", slug).maybeSingle();
  if (!store) return json({ error: "unknown store" }, 404);

  // Authorize: staff of this store OR a platform admin (all-store access). Owners
  // and platform admins may edit; other staff can ask but not change.
  const [staffRes, adminRes] = await Promise.all([
    db.from("staff").select("role").eq("store_id", store.id).eq("user_id", userId).eq("status", "active").maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  const staff = staffRes.data;
  const isAdmin = !!adminRes.data;
  if (!staff && !isAdmin) return json({ error: "forbidden" }, 403);
  const isOwner = staff?.role === "owner" || isAdmin;

  async function readConfig(): Promise<Record<string, string>> {
    const { data } = await db.from("agent_config").select("key, value").eq("store_id", store.id);
    return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  }
  async function setKey(key: string, value: string) {
    // upsert on (store_id, key)
    await db.from("agent_config").upsert({ store_id: store.id, key, value }, { onConflict: "store_id,key" });
  }

  // ── Lever B: the store's open knowledge gaps (questions customers asked that
  // Rani couldn't answer), grouped by near-identical wording, most-asked first.
  // The code→rows map lets answer_customer_question resolve exactly what it shows.
  const gapIndex = new Map<string, { ids: string[]; question: string }>();
  const gapList: { code: string; question: string; times: number }[] = [];
  {
    const { data: rows } = await db
      .from("knowledge_gap")
      .select("id, question, created_at")
      .eq("store_id", store.id)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(120);
    const groups = new Map<string, { ids: string[]; question: string; times: number }>();
    for (const r of (rows ?? []) as { id: string; question: string }[]) {
      const key = normQ(r.question).slice(0, 80) || r.id;
      const g = groups.get(key) ?? { ids: [], question: r.question, times: 0 };
      g.ids.push(r.id);
      g.times++;
      groups.set(key, g);
    }
    [...groups.values()]
      .sort((a, b) => b.times - a.times)
      .slice(0, 15)
      .forEach((g, i) => {
        const code = `g${i + 1}`;
        gapIndex.set(code, { ids: g.ids, question: g.question });
        gapList.push({ code, question: g.question, times: g.times });
      });
  }
  const openCount = gapList.length;

  const changed: string[] = [];
  const toolset: Toolset = {
    declarations: DECLARATIONS,
    execute: async (name, args) => {
      if (name === "read_settings") {
        const c = await readConfig();
        return {
          name: store.store_display_name ?? store.slug,
          type: store.business_type ?? "unknown",
          whatsapp: store.whatsapp_status ?? "inactive",
          ordering_on: (c.orders_enabled ?? "").toLowerCase() === "true",
          catalog_on: (c.catalog_enabled ?? "").toLowerCase() === "true",
          hours: c.store_hours ?? "(not set)",
          business_info: c.store_prompt ?? "(not set)",
          persona: c.personality ?? "(default)",
        };
      }
      // All edits require owner.
      if (!isOwner) return { ok: false, note: "Only the store owner can change settings." };

      if (name === "set_business_info" || name === "set_hours" || name === "set_persona") {
        const map: Record<string, string> = { set_business_info: "business_info", set_hours: "hours", set_persona: "persona" };
        const key = EDIT_KEYS[map[name]];
        const text = String(args.text ?? "").trim();
        if (!text) return { ok: false, note: "No text provided." };
        await setKey(key, text);
        changed.push(map[name]);
        return { ok: true };
      }
      if (name === "set_feature") {
        const key = args.feature === "ordering" ? "orders_enabled" : "catalog_enabled";
        await setKey(key, args.enabled ? "true" : "false");
        changed.push(`${args.feature}=${args.enabled ? "on" : "off"}`);
        return { ok: true };
      }
      if (name === "note_whatsapp_interest") {
        try { await db.from("stores").update({ whatsapp_status: "requested" }).eq("id", store.id); } catch { /* non-fatal */ }
        changed.push("whatsapp_interest");
        return { ok: true, note: "Noted — the team will reach out to help you go live on WhatsApp." };
      }
      if (name === "list_open_questions") {
        return {
          questions: gapList.map((g) => ({ code: g.code, question: g.question, times_asked: g.times })),
          count: gapList.length,
          note: gapList.length ? "Show the owner the top few in plain words and offer to answer them." : "No open questions right now.",
        };
      }
      if (name === "answer_customer_question") {
        const g = gapIndex.get(String(args.code ?? ""));
        const answer = String(args.answer ?? "").trim();
        if (!g) return { ok: false, note: "That question code isn't in the current list — call list_open_questions first." };
        if (!answer) return { ok: false, note: "No answer provided." };
        const { error } = await db.from("saved_qa").insert({
          store_id: store.id,
          question: g.question,
          answer,
          active: true,
          category: "Answered from a customer question",
        });
        if (error) return { ok: false, note: "Couldn't save that answer — try again." };
        // Clear the matching open gaps and make the new answer searchable now.
        try { await db.from("knowledge_gap").update({ status: "resolved", resolved_at: new Date().toISOString() }).in("id", g.ids); } catch { /* non-fatal */ }
        try { await syncSavedQaToIndex(db, store.id); await reindexKnowledge(db, store.id, 200); } catch { /* index best-effort */ }
        changed.push("answered_question");
        return { ok: true, note: `Saved — Rani will now answer "${g.question}" on its own.` };
      }
      return { ok: false, note: "unknown tool" };
    },
  };

  // Build the conversation for the model.
  const contents: GeminiContent[] = (body.messages ?? [])
    .filter((m) => m?.text)
    .map((m) => ({ role: m.role === "rani" ? "model" : "user", parts: [{ text: String(m.text) }] }));

  // Opening message — lead with the demand signal when there are open gaps, so the
  // owner is pulled straight to the highest-value thing they can do.
  if (contents.length === 0) {
    if (openCount > 0 && isOwner) {
      const top = gapList.slice(0, 3).map((g) => `“${g.question}”`).join(", ");
      const lead = openCount === 1 ? "a customer recently asked something" : `${openCount} things came up that customers recently asked`;
      return json({
        reply: `Hi! Heads-up: ${lead} that I couldn't answer — like ${top}. Want to add answers so I can handle them next time? Or ask me anything, or tell me what to change.`,
        changed: [],
      });
    }
    return json({ reply: "Hi! I'm Rani. Ask me anything about your store, or tell me what to change — like 'make the greeting friendlier' or 'we're closed Sundays now'.", changed: [] });
  }

  // When gaps exist, tell the copilot to champion them proactively.
  const gapNudge = openCount > 0 && isOwner
    ? `\n\nDEMAND SIGNAL — HIGHEST VALUE: ${openCount} question(s) customers recently asked that you could NOT answer (they aren't in this store's knowledge yet). Filling these is the single most useful thing the owner can do. When it fits the conversation, bring it up: call list_open_questions, show the owner the top few in plain words, and offer to answer them. When the owner gives an answer, call answer_customer_question(code, answer) so Rani handles it automatically next time. Always frame it as opportunity ("shoppers asked X — want to add an answer?"), never as a failure.`
    : "";

  const { text } = await generateReply(sys(store.store_display_name ?? store.slug, isOwner) + gapNudge, contents, toolset, {
    svc: db, storeId: store.id, kind: "owner_copilot",
  });

  return json({ reply: text ?? "Sorry, I didn't catch that — could you say it again?", changed });
});
