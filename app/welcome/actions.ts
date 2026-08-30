"use server";

import { cookies } from "next/headers";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { presetConfig } from "@/lib/business-presets";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";
import { ACTIVE_STORE_COOKIE } from "@/lib/store/active-store";
import type { Database } from "@/lib/database.types";

type AgentKey = Database["public"]["Enums"]["agent_config_key"];
export type CreateResult = { ok: true; slug: string } | { ok: false; error: string };

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

/** Canonical lead-capture request types for product / B2B companies (P3). The
 *  onboarding interview picks which apply (demo / quote / support / careers) and
 *  we seed them so the bot's file_request tool can capture leads from day one. */
type ReqField = { key: string; label: string; required: boolean };
const REQUEST_TYPE_PRESETS: Record<string, { key: string; label: string; description: string; fields: ReqField[] }> = {
  demo: {
    key: "demo_request", label: "Demo request",
    description: "A prospect wants a product demo or trial. Collect their name, work email, company, and what they want to see.",
    fields: [{ key: "name", label: "Name", required: true }, { key: "email", label: "Work email", required: true }, { key: "company", label: "Company", required: true }, { key: "use_case", label: "What they want to see", required: false }],
  },
  quote: {
    key: "sales_quote", label: "Sales & pricing",
    description: "A prospect wants pricing or to talk to sales. Collect name, work email, company, and their needs or team size.",
    fields: [{ key: "name", label: "Name", required: true }, { key: "email", label: "Work email", required: true }, { key: "company", label: "Company", required: true }, { key: "needs", label: "Needs / team size", required: false }],
  },
  support: {
    key: "support", label: "Support",
    description: "An existing customer needs help. Collect their name, email, and a description of the issue.",
    fields: [{ key: "name", label: "Name", required: true }, { key: "email", label: "Email", required: true }, { key: "issue", label: "Issue", required: true }],
  },
  careers: {
    key: "career_interest", label: "Career interest",
    description: "Someone interested in working here. Collect their name, email, and the role they're interested in.",
    fields: [{ key: "name", label: "Name", required: true }, { key: "email", label: "Email", required: true }, { key: "role", label: "Role of interest", required: false }],
  },
};

/**
 * Self-serve store creation — the Rani side of the first-run flow. Any SIGNED-IN
 * user (no admin gate) provisions their OWN store and becomes its owner:
 *   • insert the store (unique slug derived from the business name)
 *   • link the caller as owner (staff row)
 *   • seed the agent from the business-type preset (sensible bot from day one)
 *   • the credit wallet + 150 trial are created automatically by the 0080 trigger
 * Optionally attaches an email to the auth user so the umbrella can key the account
 * by email (the Insights SSO link). Sets the new store active and returns its slug.
 */
export async function createMyStore(input: {
  businessName: string;
  businessType?: string;
  ownerName?: string;
  email?: string;
  /** Optional config synthesized by the Setup Copilot interview. Overrides the
   *  business-type preset so the bot is on-brand + business-aware from turn one. */
  agent?: { personality?: string; storePrompt?: string; greeting?: string; suggestionChips?: string[] };
  /** Online/B2B only — lead types to capture (demo/quote/support/careers). Seeds
   *  request_types so the bot captures leads from day one (P3). */
  captureTypes?: string[];
  /** Q&A pairs Rani detected by crawling the business's site during onboarding.
   *  Seeded into the KB so the assistant answers from real content on day one
   *  (instead of an empty knowledge base). */
  faqs?: { q: string; a: string }[];
}): Promise<CreateResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "You're not signed in." };

  const displayName = input.businessName.trim();
  if (!displayName) return { ok: false, error: "Business or organization name is required." };

  // Signup-door intent (set by middleware from ?type=…) wins the business type, so
  // a visitor who came through the SaaS/product door lands in the SaaS console
  // regardless of what the onboarding interview classified them as.
  const cookieStore = await cookies();
  const intent = cookieStore.get("ar_intent_type")?.value?.toLowerCase();
  const businessType =
    intent && ["saas", "product", "software"].includes(intent)
      ? intent
      : input.businessType?.trim() || null;

  const db = createAdminClient();

  // Derive a unique slug (auto-suffix on collision so self-serve never dead-ends).
  const base = slugify(displayName) || "store";
  let slug = base;
  for (let i = 0; i < 6; i++) {
    const { data: ex } = await db.from("stores").select("id").eq("slug", slug).maybeSingle();
    if (!ex) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 5)}`;
  }

  const { data: store, error } = await db
    .from("stores")
    .insert({
      slug,
      store_display_name: displayName,
      business_type: businessType,
      active: true,
      whatsapp_status: "inactive",
    })
    .select("id, slug")
    .single();
  if (error || !store) return { ok: false, error: error?.message ?? "Could not create the store." };

  // Link the caller as the store owner.
  const { error: staffErr } = await db.from("staff").insert({
    user_id: ctx.user.id,
    store_id: store.id,
    role: "owner",
    status: "active",
    name: input.ownerName?.trim() || null,
  });
  if (staffErr) return { ok: false, error: staffErr.message };

  // Seed the agent from the business-type preset, then let the Setup Copilot's
  // synthesized config override the persona + business knowledge so the bot is
  // on-brand AND business-aware from the very first customer message.
  const merged: Partial<Record<AgentKey, string>> = { ...presetConfig(businessType, displayName) };
  const a = input.agent;
  if (a?.personality) {
    merged.personality = a.greeting
      ? `${a.personality}\n\nOpen new conversations with something like: "${a.greeting}"`
      : a.personality;
  }
  if (a?.storePrompt) {
    const chips = a.suggestionChips?.length ? `\n\nCommon things customers ask: ${a.suggestionChips.join("; ")}.` : "";
    merged.store_prompt = `${a.storePrompt}${chips}`;
  }
  const rows = Object.entries(merged).map(([key, value]) => ({ store_id: store.id, key: key as AgentKey, value }));
  if (rows.length) {
    const { error: cfgErr } = await db.from("agent_config").insert(rows);
    if (cfgErr) console.error("[welcome] seed config:", cfgErr.message);
  }

  // Seed lead-capture request types for a product/B2B company (P3), so the bot's
  // file_request tool can take demos/quotes/support/careers from the first chat.
  const reqRows = [...new Set(input.captureTypes ?? [])]
    .map((t) => REQUEST_TYPE_PRESETS[t])
    .filter(Boolean)
    .map((p) => ({ store_id: store.id, key: p.key, label: p.label, description: p.description, fields: p.fields, enabled: true }));
  if (reqRows.length) {
    const { error: reqErr } = await db.from("request_types").upsert(reqRows, { onConflict: "store_id,key", ignoreDuplicates: true });
    if (reqErr) console.error("[welcome] seed request types:", reqErr.message);
  }

  // Seed the KB from the site Rani crawled during onboarding, so the assistant
  // isn't answering from an empty knowledge base on day one. Write the detected
  // Q&A pairs as saved_qa, then index them (saved_qa is NOT auto-synced to the
  // retrievable knowledge_index — sync_saved_qa does the embed pass).
  const faqs = (input.faqs ?? [])
    .map((f) => ({ q: (f?.q ?? "").trim(), a: (f?.a ?? "").trim() }))
    .filter((f) => f.q && f.a)
    .slice(0, 20);
  if (faqs.length) {
    const qaRows = faqs.map((f) => ({
      store_id: store.id,
      question: f.q,
      answer: f.a,
      active: true,
      created_by: ctx.user.id,
      source_session: "onboarding",
    }));
    const { error: qaErr } = await db.from("saved_qa").insert(qaRows);
    if (qaErr) console.error("[welcome] seed saved_qa:", qaErr.message);
    else {
      try {
        await callBotAdmin({ action: "sync_saved_qa", store_slug: store.slug });
      } catch (e) {
        console.error("[welcome] index saved_qa:", (e as Error).message);
      }
    }
  }

  // Attach an email to the account (best-effort) so the umbrella can link by email
  // for "Sign in with Ask Rani". Never fatal — fails silently if it's already used.
  const email = input.email?.trim().toLowerCase();
  if (email && email !== (ctx.user.email ?? "").toLowerCase()) {
    try { await db.auth.admin.updateUserById(ctx.user.id, { email }); } catch { /* already in use / non-fatal */ }
  }

  // Make it the active store so they land straight in it; the door intent is spent.
  cookieStore.set(ACTIVE_STORE_COOKIE, store.slug, { path: "/", sameSite: "lax" });
  if (intent) cookieStore.set("ar_intent_type", "", { path: "/", maxAge: 0 });
  cookieStore.set("ar_intent_site", "", { path: "/", maxAge: 0 });
  return { ok: true, slug: store.slug };
}
