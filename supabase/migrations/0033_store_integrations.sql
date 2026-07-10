-- Custom per-store integrations (connectors) — Bot Phase 6.
-- Each row is a tool the bot exposes ONLY for that store: the model sees
-- name/description/params_schema, and when it calls the tool the core POSTs the
-- args to endpoint_url (HMAC-signed) and feeds the JSON result back. The actual
-- integration logic (POS, pricing, etc.) lives OUTSIDE this platform — the core
-- never imports a POS SDK. Purely additive: a store with no rows behaves exactly
-- as before.
create table if not exists public.store_integrations (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  name          text not null,          -- tool name the model calls (e.g. pos_price_lookup)
  description   text not null,          -- what the model reads to decide when to call it
  params_schema jsonb not null default '{"type":"object","properties":{},"required":[]}'::jsonb,
  kind          text not null default 'http',   -- 'http' now; 'mcp' later
  endpoint_url  text not null,
  auth_secret   text,                   -- shared secret for HMAC request signing (nullable)
  side_effect   boolean not null default false, -- true = writes/charges → needs confirmation
  enabled       boolean not null default true,
  timeout_ms    int not null default 4000,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (store_id, name)
);

create index if not exists store_integrations_store_idx
  on public.store_integrations (store_id) where enabled;

-- Service-role only (edge functions read it; admin manages via bot-admin). No
-- anon/authenticated policies — RLS on with none means only the service role,
-- which bypasses RLS, can touch it.
alter table public.store_integrations enable row level security;
