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
  phoneVerified: boolean;
  metadata: Record<string, unknown>;
  blocked: boolean;
};

export type AccessMode = "open" | "optional" | "required";

const MEMBER_COLS = "id, role, display_name, email, phone, phone_verified, metadata, blocked, active";

// deno-lint-ignore no-explicit-any
function shape(row: any): MemberContext {
  return {
    id: row.id,
    role: row.role ?? "member",
    name: row.display_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    phoneVerified: !!row.phone_verified,
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
      // A lapsed binding is not an identity. Null = no expiry (email-verified
      // sessions, which die with the session id itself).
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
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

// ── Embedded SSO: verify a signed identity token from the store's own site ───
// The store's backend signs `base64url(JSON).hex(hmacSHA256)` with its
// identity_secret; we verify and trust the enclosed email/phone. This lets the
// store's existing website login drive the member — no separate login from us.

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

export type IdentityClaim = {
  email?: string;
  phone?: string;
  role?: string;
  name?: string;
  metadata?: Record<string, unknown>;
};

/** Verify an embedded-SSO identity token; returns the signed claims or null.
 *  The token may carry role/name/metadata (e.g. unit) for JIT provisioning. */
export async function verifyIdentityToken(
  secret: string | null | undefined,
  token: string,
): Promise<IdentityClaim | null> {
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sig !== (await hmacHex(secret, payloadB64))) return null;
  try {
    const p = JSON.parse(b64urlDecode(payloadB64));
    if (p.exp && Date.now() / 1000 > Number(p.exp)) return null; // expired
    const email = p.email ? String(p.email) : undefined;
    const phone = p.phone ? String(p.phone) : undefined;
    if (!email && !phone) return null;
    return {
      email,
      phone,
      role: p.role ? String(p.role) : undefined,
      name: p.name ? String(p.name) : undefined,
      metadata: p.metadata && typeof p.metadata === "object" ? p.metadata : undefined,
    };
  } catch {
    return null;
  }
}

// ── Bring-your-own-JWT (JWKS) ────────────────────────────────────────────────
// A store with an existing auth provider registers its JWKS URL + issuer; the
// visitor's own JWT (RS256/ES256, asymmetric only — never HS*, which would be a
// key-confusion attack) is verified against the provider's public keys. No shared
// secret, no signing code on the customer's side.
export interface SsoConfig {
  secret?: string | null;
  jwksUrl?: string | null;
  issuer?: string | null;
  audience?: string | null;
  emailClaim?: string | null;
  nameClaim?: string | null;
}

// deno-lint-ignore no-explicit-any
const JWKS_CACHE = new Map<string, { keys: any[]; exp: number }>();
// deno-lint-ignore no-explicit-any
async function fetchJwks(url: string): Promise<any[]> {
  const c = JWKS_CACHE.get(url);
  if (c && c.exp > Date.now()) return c.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const j = await res.json();
  const keys = Array.isArray(j?.keys) ? j.keys : [];
  JWKS_CACHE.set(url, { keys, exp: Date.now() + 10 * 60 * 1000 }); // 10-min cache
  return keys;
}

const JWT_ALGS: Record<string, { name: string; hash: string; curve?: string }> = {
  RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  RS384: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
  RS512: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
  ES256: { name: "ECDSA", hash: "SHA-256", curve: "P-256" },
  ES384: { name: "ECDSA", hash: "SHA-384", curve: "P-384" },
};

function b64urlBytes(s: string): Uint8Array {
  const bin = b64urlDecode(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyJwtViaJwks(cfg: SsoConfig, token: string): Promise<IdentityClaim | null> {
  try {
    const [h, p, s] = token.split(".");
    const header = JSON.parse(b64urlDecode(h));
    const alg = JWT_ALGS[header.alg]; // unknown alg (incl. "none" and HS*) → reject
    if (!alg || !cfg.jwksUrl) return null;
    const keys = await fetchJwks(cfg.jwksUrl);
    // deno-lint-ignore no-explicit-any
    const jwk = keys.find((k: any) => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
    if (!jwk) return null;
    // deno-lint-ignore no-explicit-any
    const importParams: any = alg.curve ? { name: "ECDSA", namedCurve: alg.curve } : { name: alg.name, hash: alg.hash };
    const key = await crypto.subtle.importKey("jwk", jwk, importParams, false, ["verify"]);
    // deno-lint-ignore no-explicit-any
    const verifyParams: any = alg.curve ? { name: "ECDSA", hash: alg.hash } : { name: alg.name };
    const sigBytes = b64urlBytes(s) as unknown as BufferSource;
    const signed = new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource;
    const ok = await crypto.subtle.verify(verifyParams, key, sigBytes, signed);
    if (!ok) return null;

    const payload = JSON.parse(b64urlDecode(p));
    const now = Date.now() / 1000;
    if (payload.exp && now > Number(payload.exp)) return null; // expired
    if (payload.nbf && now < Number(payload.nbf) - 60) return null; // not yet valid
    if (cfg.issuer && payload.iss !== cfg.issuer) return null; // wrong issuer
    if (cfg.audience) {
      const aud = payload.aud;
      const audOk = Array.isArray(aud) ? aud.includes(cfg.audience) : aud === cfg.audience;
      if (!audOk) return null;
    }
    const emailClaim = cfg.emailClaim || "email";
    const nameClaim = cfg.nameClaim || "name";
    const email = payload[emailClaim] ? String(payload[emailClaim]) : undefined;
    const phone = payload.phone_number ? String(payload.phone_number) : undefined;
    if (!email && !phone) return null;
    const sub = payload.sub != null ? String(payload.sub) : undefined;
    return {
      email,
      phone,
      name: payload[nameClaim] ? String(payload[nameClaim]) : undefined,
      role: payload.role ? String(payload.role) : undefined,
      metadata: sub ? { sub } : undefined,
    };
  } catch {
    return null;
  }
}

/** Verify an embed identity token: a 3-part JWT (when JWKS is configured) OR the
 *  2-part HMAC shared-secret token. Returns the verified claims or null. */
export async function verifyEmbedIdentity(cfg: SsoConfig, token: string): Promise<IdentityClaim | null> {
  if (!token) return null;
  // A JWT has two dots (header.payload.signature); the HMAC token has exactly one.
  if (token.split(".").length === 3 && cfg.jwksUrl) {
    return await verifyJwtViaJwks(cfg, token);
  }
  return await verifyIdentityToken(cfg.secret, token);
}

/** Just-in-time provisioning: create a member from a VERIFIED SSO token's claims
 *  (the store's own backend vouched for them). Returns the member, or re-finds on
 *  a race. Null only if nothing to key on / a hard error. */
export async function provisionMember(
  db: SupabaseClient,
  storeId: string,
  claim: IdentityClaim,
): Promise<MemberContext | null> {
  const email = claim.email ? claim.email.toLowerCase() : null;
  const phone = claim.phone ?? null;
  if (!email && !phone) return null;
  const { data, error } = await db
    .from("store_members")
    .insert({
      store_id: storeId,
      email,
      phone,
      role: claim.role || "member",
      display_name: claim.name ?? null,
      metadata: claim.metadata ?? {},
    })
    .select(MEMBER_COLS)
    .single();
  if (error) {
    // Likely a race on the unique index — re-find and use the existing row.
    return await findMemberByIdentity(db, storeId, claim.email, claim.phone);
  }
  return data ? shape(data) : null;
}

/** Find a member by verified email or phone. */
export async function findMemberByIdentity(
  db: SupabaseClient,
  storeId: string,
  email?: string,
  phone?: string,
): Promise<MemberContext | null> {
  if (email) {
    const { data } = await db
      .from("store_members")
      .select(MEMBER_COLS)
      .eq("store_id", storeId)
      .eq("active", true)
      .ilike("email", email)
      .maybeSingle();
    if (data) return shape(data);
  }
  if (phone) {
    const d = digits(phone);
    const { data } = await db
      .from("store_members")
      .select(MEMBER_COLS)
      .eq("store_id", storeId)
      .eq("active", true)
      .not("phone", "is", null);
    const hit = (data ?? []).find((m: { phone: string | null }) => {
      const md = digits(m.phone ?? "");
      return md && (md === d || md.endsWith(d) || d.endsWith(md));
    });
    if (hit) return shape(hit);
  }
  return null;
}

/** Bind a web session to a verified member (so later turns resolve them). */
export async function bindMemberSession(
  db: SupabaseClient,
  sessionId: string,
  storeId: string,
  memberId: string,
  opts?: {
    /** Operate on this cart instead of the session's own — a browse link adopts
     *  the cart the sender's WhatsApp thread is already using. */
    cartSessionId?: string;
    /** Cap the binding so a borrowed browser doesn't stay signed in forever. */
    expiresAt?: string;
  },
): Promise<void> {
  await db
    .from("member_sessions")
    .upsert({
      session_id: sessionId,
      store_id: storeId,
      member_id: memberId,
      ...(opts?.cartSessionId ? { cart_session_id: opts.cartSessionId } : {}),
      ...(opts?.expiresAt ? { expires_at: opts.expiresAt } : {}),
    }, { onConflict: "session_id" });
}

/** The cart a web session should operate on: its own, unless it adopted one. */
export async function cartSessionFor(
  db: SupabaseClient,
  storeId: string,
  sessionId: string,
): Promise<string> {
  const { data } = await db
    .from("member_sessions")
    .select("cart_session_id")
    .eq("session_id", sessionId)
    .eq("store_id", storeId)
    .maybeSingle();
  return (data?.cart_session_id as string | null) ?? sessionId;
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
