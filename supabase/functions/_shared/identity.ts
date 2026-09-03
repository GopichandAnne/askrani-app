// Organization identity — the one place every front door resolves a person to a
// member. A channel produces either a signed `identityToken` (web embed) or a
// pre-verified `raw` identity (Slack/Teams); resolveIdentity verifies, applies the
// provider's domain/auto-admit policy, finds or JIT-provisions the member, binds the
// session, and returns the identity to carry into the turn.
//
// Non-breaking by construction: no token/raw ⇒ null (anonymous, as today); a store
// with no identity_providers rows falls back to the legacy stores.sso_*/identity_secret
// columns with the old always-admit behavior.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import type { Visitor } from "./httptool.ts";
import {
  bindMemberSession,
  findMemberByIdentity,
  provisionMember,
  verifyEmbedIdentity,
  type IdentityClaim,
  type MemberContext,
  type SsoConfig,
} from "./members.ts";

export interface RawIdentity {
  email?: string | null;
  phone?: string | null;
  sub?: string | null;
  name?: string | null;
  role?: string | null;
  rawToken?: string | null; // forwarded for identity-forwarding tools
}

export interface SsoProviderCfg extends SsoConfig {
  allowedDomains?: string[] | null;
  autoAdmit?: boolean;
  defaultRole?: string | null;
}

export interface ResolvedIdentity {
  member: MemberContext | null;
  visitor: Visitor;
}

// deno-lint-ignore no-explicit-any
function rowToCfg(r: any): SsoProviderCfg {
  return {
    secret: r.secret ?? null,
    jwksUrl: r.jwks_url ?? null,
    issuer: r.issuer ?? null,
    audience: r.audience ?? null,
    emailClaim: r.email_claim ?? null,
    nameClaim: r.name_claim ?? null,
    allowedDomains: Array.isArray(r.allowed_domains) ? r.allowed_domains.map((d: string) => String(d).toLowerCase()) : null,
    autoAdmit: r.auto_admit !== false,
    defaultRole: r.default_role ?? null,
  };
}

/** The store's providers (new rows), or one synthesized from the legacy columns so
 *  existing stores behave exactly as before. */
export async function loadProviders(db: SupabaseClient, store: Store): Promise<SsoProviderCfg[]> {
  const { data } = await db
    .from("identity_providers")
    .select("*")
    .eq("store_id", store.id)
    .eq("active", true);
  const rows = (data ?? []).map(rowToCfg);
  if (rows.length) return rows;
  if (store.identity_secret || store.sso_jwks_url) {
    return [{
      secret: store.identity_secret ?? null,
      jwksUrl: store.sso_jwks_url ?? null,
      issuer: store.sso_issuer ?? null,
      audience: store.sso_audience ?? null,
      emailClaim: store.sso_email_claim ?? null,
      nameClaim: store.sso_name_claim ?? null,
      allowedDomains: null,
      autoAdmit: true,
      defaultRole: null,
    }];
  }
  return [];
}

/** A 3-part JWT needs a JWKS provider; a 2-part HMAC token needs a secret. */
export function pickConfigForToken(providers: SsoProviderCfg[], token: string): SsoProviderCfg | null {
  const isJwt = token.split(".").length === 3;
  for (const p of providers) {
    if (isJwt && p.jwksUrl) return p;
    if (!isJwt && p.secret) return p;
  }
  return null;
}

function domainOk(cfg: SsoProviderCfg, email?: string): boolean {
  if (!cfg.allowedDomains || cfg.allowedDomains.length === 0) return true;
  const dom = email?.split("@")[1]?.toLowerCase();
  return !!dom && cfg.allowedDomains.includes(dom);
}

/** Verify a token against the store's providers + domain gate (no side effects).
 *  Shared by resolveIdentity and the verify-identity smoke test. */
export async function verifyIdentityForStore(
  db: SupabaseClient,
  store: Store,
  token: string,
): Promise<{ cfg: SsoProviderCfg | null; claim: IdentityClaim | null; method: string; reason?: string }> {
  const method = token.split(".").length === 3 ? "jwks" : "hmac";
  const providers = await loadProviders(db, store);
  const cfg = pickConfigForToken(providers, token);
  if (!cfg) {
    return { cfg: null, claim: null, method, reason: method === "jwks" ? "No JWKS provider is configured for this store." : "No SSO secret is configured for this store." };
  }
  const claim = await verifyEmbedIdentity(cfg, token);
  if (!claim) return { cfg, claim: null, method, reason: "Token was not accepted — bad signature, expired, wrong issuer/audience, or no email claim." };
  if (!domainOk(cfg, claim.email)) return { cfg, claim: null, method, reason: "Email domain is not allowed for this store." };
  return { cfg, claim, method };
}

/** Resolve a verified identity to a single member, JIT-provisioning per policy and
 *  binding the session. Returns null for anonymous / unconfigured / rejected — the
 *  caller then proceeds with no member, exactly as an anonymous chat does today. */
export async function resolveIdentity(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  opts: { channel: string; identityToken?: string; raw?: RawIdentity },
): Promise<ResolvedIdentity | null> {
  let claim: IdentityClaim | null = null;
  let rawToken = "";
  let autoAdmit = true;
  let defaultRole: string | null = null;

  if (opts.raw) {
    const r = opts.raw;
    if (r.email || r.phone) {
      claim = {
        email: r.email ?? undefined,
        phone: r.phone ?? undefined,
        name: r.name ?? undefined,
        role: r.role ?? undefined,
        metadata: r.sub ? { sub: r.sub } : undefined,
      };
    }
    rawToken = r.rawToken ?? "";
  } else if (opts.identityToken) {
    const v = await verifyIdentityForStore(db, store, opts.identityToken);
    claim = v.claim;
    rawToken = opts.identityToken;
    if (v.cfg) {
      autoAdmit = v.cfg.autoAdmit !== false;
      defaultRole = v.cfg.defaultRole ?? null;
    }
  }

  if (!claim || (!claim.email && !claim.phone)) return null;

  let member = await findMemberByIdentity(db, store.id, claim.email, claim.phone);
  if (!member && autoAdmit) {
    member = await provisionMember(db, store.id, { ...claim, role: claim.role || defaultRole || undefined });
  }
  if (member) await bindMemberSession(db, sessionId, store.id, member.id);

  const meta = claim.metadata as Record<string, unknown> | undefined;
  const sub = meta ? (meta.sub ?? meta.id) : undefined;
  const visitor: Visitor = {
    token: rawToken,
    email: claim.email ?? null,
    phone: claim.phone ?? null,
    sub: sub != null ? String(sub) : null,
  };
  return { member, visitor };
}
