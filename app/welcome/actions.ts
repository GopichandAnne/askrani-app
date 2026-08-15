"use server";

import { cookies } from "next/headers";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { presetConfig } from "@/lib/business-presets";
import { ACTIVE_STORE_COOKIE } from "@/lib/store/active-store";
import type { Database } from "@/lib/database.types";

type AgentKey = Database["public"]["Enums"]["agent_config_key"];
export type CreateResult = { ok: true; slug: string } | { ok: false; error: string };

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

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
}): Promise<CreateResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "You're not signed in." };

  const displayName = input.businessName.trim();
  if (!displayName) return { ok: false, error: "Business or organization name is required." };

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
      business_type: input.businessType?.trim() || null,
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

  // Seed the agent so the bot is on-brand immediately; owner fine-tunes later.
  const preset = presetConfig(input.businessType, displayName);
  const rows = Object.entries(preset).map(([key, value]) => ({ store_id: store.id, key: key as AgentKey, value }));
  if (rows.length) {
    const { error: cfgErr } = await db.from("agent_config").insert(rows);
    if (cfgErr) console.error("[welcome] seed config:", cfgErr.message);
  }

  // Attach an email to the account (best-effort) so the umbrella can link by email
  // for "Sign in with Ask Rani". Never fatal — fails silently if it's already used.
  const email = input.email?.trim().toLowerCase();
  if (email && email !== (ctx.user.email ?? "").toLowerCase()) {
    try { await db.auth.admin.updateUserById(ctx.user.id, { email }); } catch { /* already in use / non-fatal */ }
  }

  // Make it the active store so they land straight in it.
  (await cookies()).set(ACTIVE_STORE_COOKIE, store.slug, { path: "/", sameSite: "lax" });
  return { ok: true, slug: store.slug };
}
