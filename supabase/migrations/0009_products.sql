-- ═══════════════════════════════════════════════════════════════════════════
-- 0009 — products (per-store inventory)
--
-- The Phase 1 schema had no products table (the brief deferred the shape to
-- "Products.gs when that module is built"). This mirrors the catalog item shape
-- used in orders.items_json (sku/name/brand/size/unit/price) plus the inventory
-- flags the panel edits: in_stock, verified. Store-scoped (store_id, like the
-- other admin-managed tables: saved_qa / agent_config / staff).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  sku         text,
  name        text not null,
  brand       text,
  size        text,
  unit        text,
  price       numeric,
  currency    text not null default 'USD',
  in_stock    boolean not null default true,
  verified    boolean not null default false,
  category    text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_products_store on public.products(store_id);
-- one SKU per store (when present) so imports/edits can key on it
create unique index uq_products_store_sku
  on public.products(store_id, sku) where sku is not null;

create trigger trg_products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

-- Members of a store may read; any staff of the store may write (add/edit/
-- remove). (Whether price edits should be owner-only — mirroring the order
-- catalog-price guard — is a deliberate review question.)
create policy products_select on public.products
  for select to authenticated
  using (store_id in (select public.user_store_ids()));

create policy products_insert on public.products
  for insert to authenticated
  with check (store_id in (select public.user_store_ids()));

create policy products_update on public.products
  for update to authenticated
  using (store_id in (select public.user_store_ids()))
  with check (store_id in (select public.user_store_ids()));

create policy products_delete on public.products
  for delete to authenticated
  using (store_id in (select public.user_store_ids()));

-- Explicit grants (0006 pattern — deterministic across local/hosted).
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.products to service_role;
