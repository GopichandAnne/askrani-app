"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

type StaffRole = Database["public"]["Enums"]["staff_role"];

export type TeamResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export type TeamMember = {
  userId: string;
  email: string;
  name: string | null;
  role: StaffRole;
  isSelf: boolean;
};

const APP_URL = "https://app.askrani.ai";

/** Platform admin OR an owner of this store may manage its team. */
async function requireTeamManage(storeId: string) {
  const ctx = await getSessionContext();
  const allowed =
    !!ctx &&
    (ctx.isPlatformAdmin || ctx.stores.some((s) => s.id === storeId && s.role === "owner"));
  if (!ctx || !allowed) throw new Error("Not authorized");
  return ctx;
}

/** All owners + staff on a store (owners first). */
export async function listTeam(storeId: string): Promise<TeamResult<{ members: TeamMember[] }>> {
  const ctx = await requireTeamManage(storeId);
  const db = createAdminClient();
  const [{ data: staff, error }, usersRes] = await Promise.all([
    db.from("staff").select("user_id, role, name").eq("store_id", storeId).eq("status", "active"),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (error) return { ok: false, error: error.message };
  const emailById = new Map((usersRes.data?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const members: TeamMember[] = (staff ?? []).map((s) => ({
    userId: s.user_id,
    email: emailById.get(s.user_id) || "",
    name: s.name,
    role: s.role,
    isSelf: s.user_id === ctx.user.id,
  }));
  members.sort((a, b) =>
    a.role === b.role ? a.email.localeCompare(b.email) : a.role === "owner" ? -1 : 1,
  );
  return { ok: true, members };
}

/** Add an owner or staff member. If they have no account yet, invite them. */
export async function addTeamMember(input: {
  storeId: string;
  email: string;
  role: StaffRole;
  name?: string;
}): Promise<TeamResult<{ invited: boolean }>> {
  await requireTeamManage(input.storeId);
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required." };
  const role: StaffRole = input.role === "owner" ? "owner" : "staff";

  const db = createAdminClient();
  const { data: list, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) return { ok: false, error: listErr.message };
  let user = list.users.find((u) => (u.email ?? "").toLowerCase() === email);

  // Not in the system yet — invite them (creates the account + emails a sign-in
  // link). Membership is created regardless, so they see the store on first login.
  let invited = false;
  if (!user) {
    const { data: inv, error: invErr } = await db.auth.admin.inviteUserByEmail(email, {
      data: input.name?.trim() ? { name: input.name.trim() } : undefined,
      redirectTo: `${APP_URL}/auth/callback?next=/`,
    });
    if (invErr || !inv?.user) {
      return { ok: false, error: `Couldn't invite ${email}: ${invErr?.message ?? "unknown error"}` };
    }
    user = inv.user;
    invited = true;
  }

  const { error } = await db.from("staff").upsert(
    { user_id: user.id, store_id: input.storeId, role, status: "active", name: input.name?.trim() || null },
    { onConflict: "user_id,store_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/team");
  revalidatePath("/admin/stores");
  return { ok: true, invited };
}

/** Count active owners on a store (used to protect the last owner). */
async function ownerIds(db: ReturnType<typeof createAdminClient>, storeId: string): Promise<string[]> {
  const { data } = await db
    .from("staff")
    .select("user_id")
    .eq("store_id", storeId)
    .eq("role", "owner")
    .eq("status", "active");
  return (data ?? []).map((o) => o.user_id);
}

/** Remove someone from a store. Won't remove the last remaining owner. */
export async function removeTeamMember(input: {
  storeId: string;
  userId: string;
}): Promise<TeamResult> {
  await requireTeamManage(input.storeId);
  const db = createAdminClient();
  const owners = await ownerIds(db, input.storeId);
  if (owners.includes(input.userId) && owners.length <= 1) {
    return { ok: false, error: "You can't remove the last owner — add another owner first." };
  }
  const { error } = await db
    .from("staff")
    .delete()
    .eq("store_id", input.storeId)
    .eq("user_id", input.userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/team");
  revalidatePath("/admin/stores");
  return { ok: true };
}

/** Change someone's role. Won't demote the last remaining owner. */
export async function changeTeamRole(input: {
  storeId: string;
  userId: string;
  role: StaffRole;
}): Promise<TeamResult> {
  await requireTeamManage(input.storeId);
  const role: StaffRole = input.role === "owner" ? "owner" : "staff";
  const db = createAdminClient();
  if (role === "staff") {
    const owners = await ownerIds(db, input.storeId);
    if (owners.includes(input.userId) && owners.length <= 1) {
      return { ok: false, error: "You can't demote the last owner — add another owner first." };
    }
  }
  const { error } = await db
    .from("staff")
    .update({ role })
    .eq("store_id", input.storeId)
    .eq("user_id", input.userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/team");
  revalidatePath("/admin/stores");
  return { ok: true };
}
