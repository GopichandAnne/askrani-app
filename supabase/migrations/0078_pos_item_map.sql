-- Per-store, per-provider mapping from our product sku → the POS's catalog item
-- id. When an approved order is pushed, a mapped line goes to the POS as a REAL
-- menu item (so it prices/reports/decrements correctly there) instead of an
-- ad-hoc "open item". Unmapped lines still fall back to ad-hoc where the POS
-- supports it. Managed via owner-gated server actions (service-role only).
create table if not exists public.pos_item_map (
  store_id      uuid not null references public.stores(id) on delete cascade,
  provider      text not null,
  sku           text not null,         -- our products.sku
  external_id   text not null,         -- the POS catalog item / variation id
  external_name text,                  -- the POS item name (display + audit)
  updated_at    timestamptz not null default now(),
  primary key (store_id, provider, sku)
);

-- Service-role only: RLS on with no policies (same posture as
-- store_provider_credentials). The panel reads/writes it through server actions.
alter table public.pos_item_map enable row level security;
