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
];

// deno-lint-ignore no-explicit-any
type Db = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // The platform already verified the JWT (verify_jwt on); read the user from it.
  let userId = "";
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    userId = JSON.parse(atob(jwt.split(".")[1])).sub ?? "";
  } catch { /* ignore */ }
  if (!userId) return json({ error: "unauthorized" }, 401);

  let body: { storeSlug?: string; messages?: { role?: string; text?: string }[] };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const slug = String(body.storeSlug ?? "").trim().toLowerCase();
  if (!slug) return json({ error: "storeSlug required" }, 400);

  const db: Db = serviceClient();
  const { data: store } = await db.from("stores").select("id, slug, store_display_name, business_type, whatsapp_status").eq("slug", slug).maybeSingle();
  if (!store) return json({ error: "unknown store" }, 404);

  // Authorize: the caller must be staff of this store; owners may edit.
  const { data: staff } = await db.from("staff").select("role").eq("store_id", store.id).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!staff) return json({ error: "forbidden" }, 403);
  const isOwner = staff.role === "owner";

  async function readConfig(): Promise<Record<string, string>> {
    const { data } = await db.from("agent_config").select("key, value").eq("store_id", store.id);
    return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  }
  async function setKey(key: string, value: string) {
    // upsert on (store_id, key)
    await db.from("agent_config").upsert({ store_id: store.id, key, value }, { onConflict: "store_id,key" });
  }

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
      return { ok: false, note: "unknown tool" };
    },
  };

  // Build the conversation for the model.
  const contents: GeminiContent[] = (body.messages ?? [])
    .filter((m) => m?.text)
    .map((m) => ({ role: m.role === "rani" ? "model" : "user", parts: [{ text: String(m.text) }] }));
  if (contents.length === 0) return json({ reply: "Hi! I'm Rani. Ask me anything about your store, or tell me what to change — like 'make the greeting friendlier' or 'we're closed Sundays now'.", changed: [] });

  const { text } = await generateReply(sys(store.store_display_name ?? store.slug, isOwner), contents, toolset, {
    svc: db, storeId: store.id, kind: "owner_copilot",
  });

  return json({ reply: text ?? "Sorry, I didn't catch that — could you say it again?", changed });
});
