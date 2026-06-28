-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 — table privileges (grants)
--
-- Hosted Supabase grants DML on public tables to anon/authenticated by default
-- and lets RLS do the gating. The local stack does NOT reliably apply that to
-- migration-created tables, so we grant explicitly here — deterministic and
-- portable across local/hosted. RLS (0004) remains the ACTUAL access gate:
-- a granted role still sees only the rows its policies allow.
-- ═══════════════════════════════════════════════════════════════════════════

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Future tables/sequences created by this role inherit the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;

-- ── Defense in depth for secret tables ──────────────────────────────────────
-- Remove the table privilege itself so a client role cannot even ATTEMPT access
-- (a query errors with "permission denied" before RLS is consulted). The
-- service role has BYPASSRLS and its grants are separate, so trusted server code
-- is unaffected. This is stricter than "no RLS policy" alone.
revoke all on table public.store_secrets   from anon, authenticated;
revoke all on table public.platform_admins from anon, authenticated;
