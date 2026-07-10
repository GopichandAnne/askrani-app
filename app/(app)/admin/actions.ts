"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { presetConfig } from "@/lib/business-presets";
import type { Database } from "@/lib/database.types";

type AgentKey = Database["public"]["Enums"]["agent_config_key"];

export type ActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** Every admin action re-verifies platform-admin server-side — never trust the client. */
async function requireAdmin() {
  const ctx = await getSessionContext();
  if (!ctx?.isPlatformAdmin) throw new Error("Not authorized");
  return ctx;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ── Onboard a new store ──────────────────────────────────────────────────────
export type OnboardInput = {
  displayName: string;
  slug?: string;
  businessType?: string;
  ordersEnabled: boolean;
  catalogEnabled: boolean;
};

export async function onboardStore(input: OnboardInput): Promise<ActionResult<{ slug: string }>> {
  await requireAdmin();

  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, error: "Business name is required." };
  const slug = (input.slug?.trim() ? slugify(input.slug) : slugify(displayName));
  if (!slug) return { ok: false, error: "Could not derive a valid slug from the name." };

  const db = createAdminClient();

  const { data: existing } = await db.from("stores").select("id").eq("slug", slug).maybeSingle();
  if (existing) return { ok: false, error: `The slug "${slug}" is already taken. Pick another.` };

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

  // Seed the agent from the business-type preset so the store has a sensible,
  // on-brand bot from day one (the owner fine-tunes it later in Agent Setup).
  // The explicit ordering/catalogue toggles win over the preset's defaults.
  const preset = presetConfig(input.businessType, displayName);
  const rows = Object.entries(preset).map(([key, value]) => ({
    store_id: store.id,
    key: key as AgentKey,
    value,
  }));
  rows.push(
    { store_id: store.id, key: "orders_enabled", value: input.ordersEnabled ? "true" : "false" },
    { store_id: store.id, key: "catalog_enabled", value: input.catalogEnabled ? "true" : "false" },
  );
  const { error: cfgErr } = await db.from("agent_config").insert(rows);
  if (cfgErr) console.error("[admin] seed config:", cfgErr.message);

  revalidatePath("/admin/stores");
  return { ok: true, slug: store.slug };
}

// ── Assign an owner to a store ───────────────────────────────────────────────
// If the person already has an account, they're linked immediately. If not, we
// invite them (creates the account + emails a sign-in link) and link the store,
// so they land straight in it the first time they log in.
const APP_URL = "https://app.askrani.ai";

export async function assignOwner(input: {
  storeId: string;
  email: string;
  name?: string;
}): Promise<ActionResult<{ invited: boolean }>> {
  await requireAdmin();

  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required." };

  const db = createAdminClient();

  // Find the auth user by email.
  const { data: list, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) return { ok: false, error: listErr.message };
  let user = list.users.find((u) => (u.email ?? "").toLowerCase() === email);

  // Not in the system yet — invite them. This creates the account and emails a
  // sign-in link (same email system as magic-link login). The membership below
  // is created regardless, so on first login they see this store.
  let invited = false;
  if (!user) {
    const { data: inv, error: invErr } = await db.auth.admin.inviteUserByEmail(email, {
      data: input.name?.trim() ? { name: input.name.trim() } : undefined,
      redirectTo: `${APP_URL}/auth/callback?next=/`,
    });
    if (invErr || !inv?.user) {
      return { ok: false, error: `Couldn't send an invite to ${email}: ${invErr?.message ?? "unknown error"}` };
    }
    user = inv.user;
    invited = true;
  }

  const { error } = await db.from("staff").upsert(
    {
      user_id: user.id,
      store_id: input.storeId,
      role: "owner",
      status: "active",
      name: input.name?.trim() || null,
    },
    { onConflict: "user_id,store_id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/stores");
  return { ok: true, invited };
}

// ── Waitlist management ──────────────────────────────────────────────────────
export async function deleteWaitlistEntry(id: string): Promise<ActionResult> {
  await requireAdmin();
  const db = createAdminClient();
  const { error } = await db.from("waitlist").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/waitlist");
  return { ok: true };
}
