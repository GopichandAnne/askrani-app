-- ═══════════════════════════════════════════════════════════════════════════
-- 0053 — configurable order charges & fees (replaces the single tax_rate)
--
-- Each store defines any number of charges: a label + a type (percent of
-- subtotal, or a flat dollar amount) + which orders it applies to (all / pickup
-- / delivery) + on/off. Tax is just one charge. Orders store the applied
-- breakdown in orders.charges_json; orders.tax keeps holding the charges total so
-- total = subtotal + tax stays valid for anything reading the old columns.
--
-- Managed via bot-admin (service role); read by the order pipeline (service
-- role) and the panel (server-side admin read). No anon/authenticated policies.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.store_charges (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  label       text not null,
  kind        text not null default 'percent',   -- 'percent' (of subtotal) | 'flat' (dollars)
  value       numeric not null default 0,        -- percent: 8.25 = 8.25%; flat: 5 = $5.00
  applies_to  text not null default 'all',        -- 'all' | 'pickup' | 'delivery'
  enabled     boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists store_charges_store_idx on public.store_charges (store_id) where enabled;
alter table public.store_charges enable row level security; -- service-role + bot-admin only

alter table public.orders
  add column if not exists charges_json jsonb not null default '[]'::jsonb;

-- Migrate an existing tax_rate (a fraction, e.g. 0.0825) into a "Sales tax"
-- percent charge (8.25). Only for stores with a valid positive rate.
insert into public.store_charges (store_id, label, kind, value, applies_to, enabled, sort)
select c.store_id, 'Sales tax', 'percent', round((c.value)::numeric * 100, 4), 'all', true, 0
from public.agent_config c
where c.key = 'tax_rate'
  and c.value ~ '^[0-9]*\.?[0-9]+$'
  and (c.value)::numeric > 0
  and not exists (
    select 1 from public.store_charges sc where sc.store_id = c.store_id
  );
