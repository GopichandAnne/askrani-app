-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 — grant service_role on public tables
--
-- service_role is the trusted backend role (has BYPASSRLS) used by the bot's
-- Edge Functions and server routes. BYPASSRLS lets it skip RLS, but it still
-- needs the underlying TABLE privilege. Hosted Supabase grants this by default;
-- the local stack does NOT apply it to migration-created tables, so the bot
-- fails locally without it. Idempotent; redundant-but-harmless on hosted.
--
-- This intentionally includes store_secrets / platform_admins: service_role is
-- exactly who SHOULD read those (the bot reads WhatsApp tokens). anon /
-- authenticated remain revoked (0006) — client roles still can't touch them.
-- ═══════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
