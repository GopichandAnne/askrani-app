-- ═══════════════════════════════════════════════════════════════════════════
-- 0010 — owner-gate catalog/money actions on products
--
-- Adding, removing, and re-pricing a product are catalog/money actions →
-- OWNER (or platform admin) only. in_stock / verified stay any-staff floor work.
--
--   INSERT / DELETE -> owner-only RLS. RLS is enforced on every path (incl. raw
--     PostgREST), so this already closes the bypass — no trigger needed.
--   UPDATE price     -> trigger. RLS can't express "this column changed", so a
--     BEFORE UPDATE trigger blocks non-owners from changing price while still
--     allowing them to toggle in_stock / verified.
--
-- service_role / postgres bypass (auth.role() <> 'authenticated').
-- ═══════════════════════════════════════════════════════════════════════════

-- ── add: owners only ────────────────────────────────────────────────────────
drop policy if exists products_insert on public.products;
create policy products_insert on public.products
  for insert to authenticated
  with check (public.user_is_owner(store_id));

-- ── remove: owners only ─────────────────────────────────────────────────────
drop policy if exists products_delete on public.products;
create policy products_delete on public.products
  for delete to authenticated
  using (public.user_is_owner(store_id));

-- ── update stays any-staff (toggles), but price changes are owner-only ──────
create or replace function public.enforce_product_price_owner_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- only end-user (authenticated) writes are gated; trusted roles bypass
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  -- owners (and platform admins) may change anything
  if public.user_is_owner(new.store_id) then
    return new;
  end if;
  -- non-owner: price must not change (in_stock/verified/etc. are fine)
  if new.price is distinct from old.price then
    raise exception 'Only owners can change product prices'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_price_guard on public.products;
create trigger trg_products_price_guard
  before update on public.products
  for each row
  execute function public.enforce_product_price_owner_only();
