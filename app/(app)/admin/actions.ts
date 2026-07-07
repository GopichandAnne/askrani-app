"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

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

  // Seed the two mode toggles so the store starts in a known state; the owner
  // configures the rest from the Agent screen.
  const { error: cfgErr } = await db.from("agent_config").insert([
    { store_id: store.id, key: "orders_enabled", value: input.ordersEnabled ? "true" : "false" },
    { store_id: store.id, key: "catalog_enabled", value: input.catalogEnabled ? "true" : "false" },
  ]);
  if (cfgErr) console.error("[admin] seed config:", cfgErr.message);

  revalidatePath("/admin/stores");
  return { ok: true, slug: store.slug };
}

// ── Assign an owner to a store (must already have an account) ─────────────────
export async function assignOwner(input: {
  storeId: string;
  email: string;
  name?: string;
}): Promise<ActionResult> {
  await requireAdmin();

  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required." };

  const db = createAdminClient();

  // Find the auth user by email (they must have signed in at least once).
  const { data: list, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) return { ok: false, error: listErr.message };
  const user = list.users.find((u) => (u.email ?? "").toLowerCase() === email);
  if (!user) {
    return {
      ok: false,
      error: "No account with that email has signed in yet. Ask them to sign in once, then assign.",
    };
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
  return { ok: true };
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
