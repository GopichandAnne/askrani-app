-- Per-store credentials for prebuilt provider connectors (Stripe, and later
-- Square/Toast). The owner connects a provider once; our hosted adapter reads
-- the store's credential and calls the provider on its behalf. Service-role only.

create table if not exists public.store_provider_credentials (
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null,                       -- 'stripe', 'square', …
  credentials jsonb not null default '{}'::jsonb, -- {secret_key} / {access_token,…}
  connected boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (store_id, provider)
);
alter table public.store_provider_credentials enable row level security;
