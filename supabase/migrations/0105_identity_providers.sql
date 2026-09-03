-- ═══════════════════════════════════════════════════════════════════════════
-- 0105 — identity_providers: the organization identity model, phase 1.
--
-- Promotes the single per-store SSO config (the stores.sso_* columns + the HMAC
-- identity_secret) into 0..n provider rows, so an org can register its IdP once and
-- every front door (web, Slack, Teams, email) reconciles through it. The legacy
-- columns are KEPT and still honored — a store with no provider rows falls back to
-- them, so nothing breaks. NULL/empty everywhere ⇒ anonymous, exactly as today.
--
-- Locked to the service role (RLS on, no policies): the edge bot reads it with the
-- service key, the console writes it with the admin client. No user-token access.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.identity_providers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  type text not null default 'jwks',            -- jwks | slack | teams | google | email_otp | whatsapp
  label text,
  -- JWKS / JWT verification (bring-your-own auth provider)
  jwks_url text,
  issuer text,
  audience text,
  email_claim text,
  name_claim text,
  -- HMAC shared-secret (an alternative to a per-store column)
  secret text,
  -- Directory-trust policy
  allowed_domains text[],                        -- e.g. {acme.com} — auto-admit only these
  auto_admit boolean not null default true,      -- off ⇒ must already be a member (gate to a roster)
  default_role text,                             -- role assigned on just-in-time provisioning
  claim_role_map jsonb,                          -- { "<claim>.<value>": "<role>" } — attribute → role (applied later)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists identity_providers_store_active
  on public.identity_providers (store_id) where active;

alter table public.identity_providers enable row level security;
-- (no policies: service role bypasses RLS; the table is never read with a user token)

-- Where a member came from, for provenance (roster import vs a specific provider).
alter table public.store_members add column if not exists identity_source text;
