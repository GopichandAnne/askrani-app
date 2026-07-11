"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export type AccessMode = "open" | "optional" | "required";
export type MemberResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
export type Member = {
  id: string;
  email: string | null;
  phone: string | null;
  role: string;
  displayName: string | null;
  blocked: boolean;
};

/** Platform admin OR an owner of this store may manage its members. */
async function requireMemberManage(storeId: string) {
  const ctx = await getSessionContext();
  const allowed =
    !!ctx &&
    (ctx.isPlatformAdmin || ctx.stores.some((s) => s.id === storeId && s.role === "owner"));
  if (!ctx || !allowed) throw new Error("Not authorized");
  return ctx;
}

function toMember(r: {
  id: string;
  email: string | null;
  phone: string | null;
  role: string;
  display_name: string | null;
  blocked: boolean;
}): Member {
  return { id: r.id, email: r.email, phone: r.phone, role: r.role, displayName: r.display_name, blocked: r.blocked };
}

export async function getMemberSettings(
  storeId: string,
): Promise<MemberResult<{ mode: AccessMode; members: Member[]; hasSso: boolean }>> {
  await requireMemberManage(storeId);
  const db = createAdminClient();
  const [{ data: store }, { data: rows, error }] = await Promise.all([
    db.from("stores").select("access_control, identity_secret").eq("id", storeId).single(),
    db
      .from("store_members")
      .select("id, email, phone, role, display_name, blocked")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false }),
  ]);
  if (error) return { ok: false, error: error.message };
  const mode = ((store?.access_control as AccessMode) ?? "open") satisfies AccessMode;
  return {
    ok: true,
    mode,
    members: (rows ?? []).map(toMember),
    hasSso: !!store?.identity_secret,
  };
}

export async function setAccessMode(storeId: string, mode: AccessMode): Promise<MemberResult> {
  await requireMemberManage(storeId);
  const m: AccessMode = mode === "required" ? "required" : mode === "optional" ? "optional" : "open";
  const db = createAdminClient();
  const { error } = await db.from("stores").update({ access_control: m }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/members");
  return { ok: true };
}

export async function addMember(
  storeId: string,
  input: { email?: string; phone?: string; role: string; name?: string },
): Promise<MemberResult<{ member: Member }>> {
  await requireMemberManage(storeId);
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() ? "+" + input.phone.replace(/[^0-9]/g, "") : null;
  if (!email && !phone) return { ok: false, error: "Add an email or a phone number." };
  const role = input.role?.trim() || "member";
  const db = createAdminClient();
  const { data, error } = await db
    .from("store_members")
    .insert({ store_id: storeId, email, phone, role, display_name: input.name?.trim() || null })
    .select("id, email, phone, role, display_name, blocked")
    .single();
  if (error) {
    return {
      ok: false,
      error: /duplicate|unique/i.test(error.message) ? "That email or phone is already a member." : error.message,
    };
  }
  revalidatePath("/members");
  return { ok: true, member: toMember(data) };
}

export async function setMemberBlocked(
  storeId: string,
  memberId: string,
  blocked: boolean,
): Promise<MemberResult> {
  await requireMemberManage(storeId);
  const db = createAdminClient();
  const { error } = await db
    .from("store_members")
    .update({ blocked })
    .eq("id", memberId)
    .eq("store_id", storeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/members");
  return { ok: true };
}

export async function removeMember(storeId: string, memberId: string): Promise<MemberResult> {
  await requireMemberManage(storeId);
  const db = createAdminClient();
  const { error } = await db.from("store_members").delete().eq("id", memberId).eq("store_id", storeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/members");
  return { ok: true };
}

/** Create (or rotate) the store's embedded-SSO signing secret. Shown once. */
export async function generateSsoSecret(
  storeId: string,
): Promise<MemberResult<{ secret: string }>> {
  await requireMemberManage(storeId);
  const secret =
    "sso_" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const db = createAdminClient();
  const { error } = await db.from("stores").update({ identity_secret: secret }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/members");
  return { ok: true, secret };
}
