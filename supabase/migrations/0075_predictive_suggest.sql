-- Predictive suggestions: "your usual" (history, already available), owner
-- specials, and real time-of-day popularity.
--
-- 1) products.featured — owner marks a dish as a special / today's feature.
alter table public.products add column if not exists featured boolean not null default false;
create index if not exists products_featured_idx on public.products(store_id) where featured;

-- 2) popular_products_daypart — most-ordered in the guest's current daypart, from
--    real order timestamps shifted to the guest's local time (offset in minutes,
--    as JS getTimezoneOffset). Same item shape as popular_products so the diner
--    renders it identically. Daypart windows: morning 5–11, afternoon 11–16,
--    evening 16–22, late 22–5.
create or replace function public.popular_products_daypart(
  p_store_id    uuid,
  p_offset_min  int default 0,
  p_daypart     text default 'evening',
  p_show_prices boolean default true,
  p_limit       int default 8
)
returns json
language sql
security definer
stable
set search_path = public, extensions
as $$
  with counts as (
    select (it->>'sku') as sku,
           sum(coalesce(nullif(it->>'quantity', '')::numeric, 1)) as qty
    from public.orders o
    join public.stores s on s.slug = o.store_slug and s.id = p_store_id
    cross join lateral jsonb_array_elements(o.items_json) it,
    lateral (select extract(hour from (o.created_at - make_interval(mins => p_offset_min))) as h) hh
    where o.status not in ('cancelled', 'rejected')
      and o.created_at > now() - interval '120 days'
      and coalesce(it->>'sku', '') <> ''
      and (case lower(p_daypart)
             when 'morning'   then hh.h >= 5  and hh.h < 11
             when 'afternoon' then hh.h >= 11 and hh.h < 16
             when 'evening'   then hh.h >= 16 and hh.h < 22
             when 'late'      then hh.h >= 22 or  hh.h < 5
             else true end)
    group by 1
  ),
  top as (
    select p.sku, p.name, p.brand, p.size, p.unit, p.price, p.currency, p.category,
           p.image_url, p.in_stock, p.allergens, p.dietary, p.modifiers, c.qty
    from counts c
    join public.products p on p.store_id = p_store_id and p.sku = c.sku and p.in_stock
    order by c.qty desc, p.name
    limit greatest(p_limit, 1)
  )
  select coalesce(
    json_agg(json_build_object(
      'sku', t.sku, 'name', t.name, 'brand', t.brand, 'size', t.size, 'unit', t.unit,
      'price', case when p_show_prices then t.price else null end,
      'currency', t.currency, 'category', t.category, 'image_url', t.image_url,
      'in_stock', t.in_stock, 'allergens', t.allergens, 'dietary', t.dietary,
      'modifiers', t.modifiers
    ) order by t.qty desc, t.name),
    '[]'::json
  )
  from top t;
$$;

grant execute on function public.popular_products_daypart(uuid, int, text, boolean, int) to service_role, authenticated;
