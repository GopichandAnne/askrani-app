-- ═══════════════════════════════════════════════════════════════════════════
-- 0048 — config audit log
--
-- A lightweight trail of assistant-config changes (request types + notification
-- subscriptions), so owners can see what changed — especially what a
-- natural-language instruction did. Written by bot-admin on apply/save/delete.
-- Service-role only (bot-admin reads/writes); no anon/authenticated policies.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.config_audit (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  actor       text,                          -- email of the owner who made the change
  source      text not null default 'manual', -- 'nl' (a sentence) | 'manual'
  summary     text not null,                 -- human-readable line
  details     jsonb not null default '{}'::jsonb, -- {instruction?, applied[], skipped[]}
  created_at  timestamptz not null default now()
);

create index if not exists config_audit_store_idx
  on public.config_audit (store_id, created_at desc);

alter table public.config_audit enable row level security; -- service-role + bot-admin only
