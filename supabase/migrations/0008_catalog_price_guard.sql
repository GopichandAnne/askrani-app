-- ═══════════════════════════════════════════════════════════════════════════
-- 0008 — DB-level guard: only owners may change a catalog line's unit_price
--
-- The editOrder server action already enforces this, but a staff member holds
-- their own session token and could call PostgREST directly, bypassing the app.
-- This BEFORE UPDATE trigger enforces the same rule in the database, so the raw
-- API path can't skip it (or the audit).
--
-- Scope: only `authenticated` end-user writes are checked. service_role (bot
-- dual-write, our server routes) and postgres (migrations/seed) bypass — they
-- have auth.role() <> 'authenticated'. Owners/platform admins always pass.
-- Status-only updates (approve/confirm/reject/cancel) leave items_json's catalog
-- prices unchanged, so staff can still run those.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.enforce_catalog_price_owner_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_cat jsonb;
  new_cat jsonb;
begin
  -- Only end-user (authenticated) writes are gated; trusted roles bypass.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;

  -- Owners (and platform admins) may change any price.
  if public.user_is_owner(
       (select s.id from public.stores s where s.slug = new.store_slug)
     ) then
    return new;
  end if;

  -- Non-owner: the catalog (sku → unit_price) set must be identical pre/post.
  select coalesce(
           jsonb_agg(jsonb_build_array(e->>'sku', e->'unit_price')
                     order by e->>'sku', e->>'item_id'),
           '[]'::jsonb)
    into old_cat
    from jsonb_array_elements(coalesce(old.items_json, '[]'::jsonb)) e
    where coalesce((e->>'catalog_matched')::boolean, false);

  select coalesce(
           jsonb_agg(jsonb_build_array(e->>'sku', e->'unit_price')
                     order by e->>'sku', e->>'item_id'),
           '[]'::jsonb)
    into new_cat
    from jsonb_array_elements(coalesce(new.items_json, '[]'::jsonb)) e
    where coalesce((e->>'catalog_matched')::boolean, false);

  if old_cat is distinct from new_cat then
    raise exception 'Only owners can change catalog prices'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_catalog_price_guard on public.orders;
create trigger trg_orders_catalog_price_guard
  before update on public.orders
  for each row
  execute function public.enforce_catalog_price_owner_only();
