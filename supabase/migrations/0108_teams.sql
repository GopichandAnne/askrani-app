-- ═══════════════════════════════════════════════════════════════════════════
-- 0108 — Microsoft Teams front door. One Azure bot serves many tenants; teams_installs
-- maps a tenant to a store (the owner enters their Azure tenant id in the console).
-- teams_events dedups Bot Framework deliveries by activity id. Service-role only.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.teams_installs (
  tenant_id text primary key,               -- Azure AD tenant (directory) id
  store_id uuid not null references public.stores(id) on delete cascade,
  team_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists teams_installs_store on public.teams_installs (store_id);

create table if not exists public.teams_events (
  activity_id text primary key,
  seen_at timestamptz not null default now()
);

alter table public.teams_installs enable row level security;
alter table public.teams_events enable row level security;
-- (no policies: service role bypasses RLS)
