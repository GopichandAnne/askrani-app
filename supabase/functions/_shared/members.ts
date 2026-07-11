// End-user identity resolution. A store can keep a directory of its own end
// users (store_members) and gate/personalize the agent by who they are.
//
// Identity per channel:
//   - WhatsApp: the sender's phone (wa_<phone>) matched to a member's phone.
//   - Web:      an email the visitor verified, bound to their session in
//               member_sessions (web_<id> -> member).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";

export type MemberContext = {
  id: string;
  role: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
  blocked: boolean;
};

export type AccessMode = "open" | "optional" | "required";

const MEMBER_COLS = "id, role, display_name, email, phone, metadata, blocked, active";

// deno-lint-ignore no-explicit-any
function shape(row: any): MemberContext {
  return {
    id: row.id,
    role: row.role ?? "member",
    name: row.display_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    blocked: !!row.blocked,
  };
}

/** Normalize a phone to digits for a tolerant match (with/without +, spaces). */
function digits(p: string): string {
  return p.replace(/\D/g, "");
}

/** Resolve the end user behind a session, or null if unknown/anonymous. */
export async function resolveMember(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
): Promise<MemberContext | null> {
  if (sessionId.startsWith("wa_")) {
    const d = digits(sessionId.slice(3));
    const { data } = await db
      .from("store_members")
      .select(MEMBER_COLS)
      .eq("store_id", store.id)
      .eq("active", true)
      .not("phone", "is", null);
    // Tolerant phone match (last 10+ digits) — numbers may vary by country prefix.
    const hit = (data ?? []).find((m: { phone: string | null }) => {
      const md = digits(m.phone ?? "");
      return md && (md === d || md.endsWith(d) || d.endsWith(md));
    });
    return hit ? shape(hit) : null;
  }
  if (sessionId.startsWith("web_")) {
    const { data: sess } = await db
      .from("member_sessions")
      .select("member_id")
      .eq("session_id", sessionId)
      .eq("store_id", store.id)
      .maybeSingle();
    if (!sess?.member_id) return null;
    const { data: m } = await db
      .from("store_members")
      .select(MEMBER_COLS)
      .eq("id", sess.member_id)
      .eq("active", true)
      .maybeSingle();
    return m ? shape(m) : null;
  }
  return null;
}

export function accessMode(store: Store): AccessMode {
  const v = (store.access_control ?? "open").toLowerCase();
  return v === "required" ? "required" : v === "optional" ? "optional" : "open";
}

/** The identity line injected into the prompt so the store can distinguish by
 *  role. Empty for open stores with an anonymous visitor. */
export function identityContext(member: MemberContext | null, mode: AccessMode): string {
  if (member) {
    const meta = Object.keys(member.metadata).length ? ` Details: ${JSON.stringify(member.metadata)}.` : "";
    const who = member.name ? ` (${member.name})` : "";
    return (
      `\n[END-USER IDENTITY: a VERIFIED "${member.role}"${who}. Treat them as a ${member.role} — ` +
      `you may help with role-specific and account-related needs for a ${member.role}.${meta}]`
    );
  }
  if (mode === "optional") {
    return (
      `\n[END-USER IDENTITY: an UNVERIFIED public visitor. Give general/public help only. ` +
      `For anything account-specific or members-only, invite them to verify their identity first.]`
    );
  }
  return "";
}
