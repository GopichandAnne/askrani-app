-- ═══════════════════════════════════════════════════════════════════════════
-- 0046 — career requests (recruiting leads captured by the web assistant)
--
-- When a visitor tells the assistant they're looking for work, the bot collects
-- the roles they want, their key skills, and an email, then calls the
-- `capture_career_interest` connector (supabase/functions/career-intake). That
-- function writes one row here AND emails HR. Owners/HR review the queue in the
-- control panel (/career-requests) via the bot-admin list_career_requests action.
--
-- Service-role only: the connector inserts, bot-admin reads/updates — both use
-- the service role, which bypasses RLS. No anon/authenticated policies.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.career_requests (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  email       text not null,                 -- how HR reaches back
  positions   text,                          -- roles the visitor is looking for
  skills      text,                          -- their key skills / stack
  notes       text,                          -- anything else the visitor added
  session_id  text,                          -- web/whatsapp session that produced it
  status      text not null default 'new',   -- new | reviewed | contacted | closed
  created_at  timestamptz not null default now()
);

create index if not exists career_requests_store_idx
  on public.career_requests (store_id, created_at desc);

alter table public.career_requests enable row level security; -- service-role + bot-admin only
