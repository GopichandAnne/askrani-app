-- Audit trail for the Insights access grant (who turned it on/off, for which
-- store, when). Written by the setInsightsAccess admin action; read on
-- /admin/stores to show the latest change per store. Service-role managed
-- (no client RLS policy), like platform_admins.

create table if not exists public.insights_access_audit (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  enabled       boolean not null,               -- the state AFTER the change
  actor_user_id uuid,                            -- who made the change (auth.users)
  actor_email   text,                            -- denormalized for easy display
  created_at    timestamptz not null default now()
);

create index if not exists insights_access_audit_store_idx
  on public.insights_access_audit (store_id, created_at desc);
create index if not exists insights_access_audit_time_idx
  on public.insights_access_audit (created_at desc);

alter table public.insights_access_audit enable row level security;
