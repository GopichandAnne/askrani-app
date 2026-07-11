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
): Promise<MemberResult<{ mode: AccessMode; members: Member[]; hasSso: boolean; emailVerification: boolean }>> {
  await requireMemberManage(storeId);
  const db = createAdminClient();
  const [{ data: store }, { data: rows, error }] = await Promise.all([
    db.from("stores").select("access_control, identity_secret, web_email_verification").eq("id", storeId).single(),
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
    emailVerification: !!store?.web_email_verification,
  };
}

export async function setEmailVerification(storeId: string, on: boolean): Promise<MemberResult> {
  await requireMemberManage(storeId);
  const db = createAdminClient();
  const { error } = await db.from("stores").update({ web_email_verification: on }).eq("id", storeId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/members");
  return { ok: true };
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

// ── CSV bulk import ─────────────────────────────────────────────────────────
// Split one CSV line, honoring simple double-quoted fields.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

type ParsedRow = {
  email: string | null;
  phone: string | null;
  role: string;
  name: string | null;
  metadata: Record<string, string>;
};

const KNOWN = new Set(["email", "phone", "role", "name", "display_name", "full_name"]);

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  if (!header.includes("email") && !header.includes("phone")) return [];
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length && rows.length < 5000; i++) {
    const cells = splitCsvLine(lines[i]);
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => (rec[h] = (cells[idx] ?? "").trim()));
    const email = rec.email ? rec.email.toLowerCase() : null;
    const phone = rec.phone ? "+" + rec.phone.replace(/[^0-9]/g, "") : null;
    if (!email && !phone) continue;
    const metadata: Record<string, string> = {};
    for (const h of header) if (!KNOWN.has(h) && rec[h]) metadata[h] = rec[h];
    rows.push({
      email,
      phone: phone && phone.length > 5 ? phone : null,
      role: rec.role || "member",
      name: rec.name || rec.display_name || rec.full_name || null,
      metadata,
    });
  }
  return rows;
}

/** Bulk import/update members from CSV (a header + email and/or phone column). */
export async function importMembers(
  storeId: string,
  csvText: string,
): Promise<MemberResult<{ added: number; updated: number; skipped: number }>> {
  await requireMemberManage(storeId);
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { ok: false, error: "No rows found. Include a header row with an 'email' or 'phone' column." };
  }
  const db = createAdminClient();
  const { data: existing } = await db
    .from("store_members")
    .select("id, email, phone")
    .eq("store_id", storeId);
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const e of existing ?? []) {
    if (e.email) byEmail.set(e.email.toLowerCase(), e.id);
    if (e.phone) byPhone.set(e.phone, e.id);
  }

  const inserts: ParsedRow[] = [];
  const updates: (ParsedRow & { id: string })[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of rows) {
    const key = `${r.email ?? ""}|${r.phone ?? ""}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const id = (r.email && byEmail.get(r.email)) || (r.phone && byPhone.get(r.phone)) || null;
    if (id) updates.push({ ...r, id });
    else inserts.push(r);
  }

  let added = 0;
  if (inserts.length > 0) {
    const { error } = await db.from("store_members").insert(
      inserts.map((r) => ({
        store_id: storeId,
        email: r.email,
        phone: r.phone,
        role: r.role,
        display_name: r.name,
        metadata: r.metadata,
      })),
    );
    if (error) {
      return { ok: false, error: `Import failed: ${error.message}` };
    }
    added = inserts.length;
  }
  let updated = 0;
  for (const u of updates) {
    const { error } = await db
      .from("store_members")
      .update({ role: u.role, display_name: u.name, metadata: u.metadata })
      .eq("id", u.id);
    if (!error) updated++;
  }
  revalidatePath("/members");
  return { ok: true, added, updated, skipped };
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
