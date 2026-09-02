-- ═══════════════════════════════════════════════════════════════════════════
-- 0104 — bring-your-own-JWT (JWKS) for embedded SSO. A store that already has an
-- auth provider (Auth0, Clerk, Firebase, Cognito, their own JWT) can register its
-- JWKS URL + issuer and pass the JWT it ALREADY mints as data-user-token — we
-- verify it against their public keys. No shared secret, no signing code.
--
-- All NULL for every existing store, so the current HMAC shared-secret path is
-- unchanged. A store may have EITHER method (or the HMAC secret) configured.
--   sso_jwks_url    — the provider's JWKS endpoint (public keys)
--   sso_issuer      — expected `iss` claim (optional but recommended)
--   sso_audience    — expected `aud` claim (optional)
--   sso_email_claim — claim holding the user's email (default 'email')
--   sso_name_claim  — claim holding the display name (default 'name')
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.stores add column if not exists sso_jwks_url text;
alter table public.stores add column if not exists sso_issuer text;
alter table public.stores add column if not exists sso_audience text;
alter table public.stores add column if not exists sso_email_claim text;
alter table public.stores add column if not exists sso_name_claim text;
