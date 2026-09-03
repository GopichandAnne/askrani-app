"use server";

import { revalidatePath } from "next/cache";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// The organization-identity config: 0..n providers per store. This is the single
// home for "how people sign in" — every front door resolves through them.
export type IdentityProviderInput = {
  id?: string;
  type: string; // "jwks" | "secret"
  label: string;
  jwks_url: string;
  issuer: string;
  audience: string;
  email_claim: string;
  name_claim: string;
  secret: string;
  allowed_domains: string; // comma-separated in the form
  auto_admit: boolean;
  default_role: string;
};
export type ProviderResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

async function requireOwner(storeId: string) {
  const ctx = await getActiveStore();
  if (!ctx?.active || ctx.active.id !== storeId) throw new Error("No access to this store.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: storeId });
  if (!isOwner) throw new Error("Owners only.");
}

export async function listIdentityProviders(storeId: string): Promise<ProviderResult<{ providers: IdentityProviderInput[] }>> {
  await requireOwner(storeId);
  const db = createAdminClient();
  const { data, error } = await db
    .from("identity_providers")
    .select("*")
    .eq("store_id", storeId)
    .eq("active", true)
    .order("created_at");
  if (error) return { ok: false, error: error.message };
  const providers = (data ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    label: r.label ?? "",
    jwks_url: r.jwks_url ?? "",
    issuer: r.issuer ?? "",
    audience: r.audience ?? "",
    email_claim: r.email_claim ?? "",
    name_claim: r.name_claim ?? "",
    secret: r.secret ?? "",
    allowed_domains: (r.allowed_domains ?? []).join(", "),
    auto_admit: r.auto_admit,
    default_role: r.default_role ?? "",
  }));
  return { ok: true, providers };
}

export async function saveIdentityProvider(storeId: string, p: IdentityProviderInput): Promise<ProviderResult<{ id: string }>> {
  await requireOwner(storeId);
  if (p.type === "jwks") {
    const url = p.jwks_url.trim();
    if (!url) return { ok: false, error: "A JWKS URL is required." };
    if (!/^https:\/\/.+/i.test(url)) return { ok: false, error: "JWKS URL must be an https:// URL." };
  }
  if (p.type === "secret" && !p.secret.trim()) return { ok: false, error: "Generate or paste a secret first." };

  const domains = p.allowed_domains.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const row = {
    store_id: storeId,
    type: p.type,
    label: p.label.trim() || null,
    jwks_url: p.type === "jwks" ? p.jwks_url.trim() : null,
    issuer: p.issuer.trim() || null,
    audience: p.audience.trim() || null,
    email_claim: p.email_claim.trim() || null,
    name_claim: p.name_claim.trim() || null,
    secret: p.type === "secret" ? p.secret.trim() : null,
    allowed_domains: domains.length ? domains : null,
    auto_admit: p.auto_admit,
    default_role: p.default_role.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const db = createAdminClient();
  if (p.id) {
    const { error } = await db.from("identity_providers").update(row).eq("id", p.id).eq("store_id", storeId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/link");
    return { ok: true, id: p.id };
  }
  const { data, error } = await db.from("identity_providers").insert(row).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/link");
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteIdentityProvider(storeId: string, id: string): Promise<ProviderResult> {
  await requireOwner(storeId);
  const db = createAdminClient();
  // Soft-delete so the resolver stops using it but history is preserved.
  const { error } = await db.from("identity_providers").update({ active: false }).eq("id", id).eq("store_id", storeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/link");
  return { ok: true };
}
