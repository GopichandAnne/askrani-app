-- 0068 — Item modifiers (customization options: size, add-ons, "no onions", …)
--
-- A product's modifier groups + options live in one jsonb column. Shape:
--   [ { id, name, type:'single'|'multi', required, min, max,
--       options: [ { id, name, price_delta } ] } ]
-- price_delta is in the store currency (0 for a plain choice like "no onions").
-- Empty '[]' = no customization, which is every existing product → no behaviour
-- change anywhere until a store defines modifiers.

alter table public.products add column if not exists modifiers jsonb not null default '[]'::jsonb;

comment on column public.products.modifiers is
  'Modifier groups + options for customization. [] = none. Deltas are authoritative — priced server-side, never from the client.';

-- browse_products v3: carry each item's modifier definition so the diner can open
-- a customization picker. Same signature as 0066 → create-or-replace, no drop.
create or replace function public.browse_products(
  p_store_id          uuid,
  p_query             text default null,
  p_query_embedding   extensions.vector(768) default null,
  p_categories        text[] default null,
  p_brands            text[] default null,
  p_price_min         numeric default null,
  p_price_max         numeric default null,
  p_in_stock          boolean default null,
  p_skus              text[] default null,
  p_limit             int default 40,
  p_offset            int default 0,
  p_show_prices       boolean default true,
  p_dietary           text[] default null,
  p_exclude_allergens text[] default null
)
returns json
language sql
security definer
stable
set search_path = public, extensions
as $$
  with filtered as (
    select p.id, p.sku, p.name, p.brand, p.size, p.unit, p.price, p.currency,
           p.category, p.image_url, p.in_stock, p.embedding, p.allergens, p.dietary, p.modifiers
    from public.products p
    where p.store_id = p_store_id
      and (p_categories is null or p.category = any(p_categories))
      and (p_brands     is null or p.brand    = any(p_brands))
      and (p_price_min  is null or p.price   >= p_price_min)
      and (p_price_max  is null or p.price   <= p_price_max)
      and (p_in_stock   is null or p.in_stock = p_in_stock)
      and (p_skus       is null or p.sku      = any(p_skus))
      and (p_dietary    is null or p.dietary @> p_dietary)
      and (p_exclude_allergens is null or not (p.allergens && p_exclude_allergens))
  ),
  cand as (
    select f.id from filtered f
    where p_query is null or p_query = ''
    union
    select f.id from filtered f
    where p_query is not null and p_query <> ''
      and (f.name ilike '%' || p_query || '%' or f.brand ilike '%' || p_query || '%'
        or f.category ilike '%' || p_query || '%' or f.sku ilike '%' || p_query || '%')
    union
    select v.id from (
      select f.id from filtered f
      where p_query_embedding is not null and f.embedding is not null
      order by f.embedding <=> p_query_embedding
      limit greatest(p_limit + p_offset, 60)
    ) v
  ),
  base as ( select f.* from filtered f join cand c on c.id = f.id ),
  scored as (
    select b.*,
      case when p_query_embedding is not null and b.embedding is not null
           then 1 - (b.embedding <=> p_query_embedding) else 0 end as vscore,
      case when p_query is null or p_query = '' then 0 else similarity(coalesce(b.name, ''), p_query) end as tscore
    from base b
  ),
  ranked as (
    select s.*, (s.vscore * 0.6 + s.tscore * 0.4) as score
    from scored s
    order by (s.vscore * 0.6 + s.tscore * 0.4) desc, s.in_stock desc, s.name asc
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select json_build_object(
    'total', (select count(*) from base),
    'prices_hidden', not p_show_prices,
    'items', coalesce((
      select json_agg(json_build_object(
        'sku', r.sku, 'name', r.name, 'brand', r.brand, 'size', r.size, 'unit', r.unit,
        'price', case when p_show_prices then r.price else null end,
        'currency', r.currency, 'category', r.category,
        'image_url', r.image_url, 'in_stock', r.in_stock,
        'allergens', r.allergens, 'dietary', r.dietary, 'modifiers', r.modifiers
      ) order by r.score desc, r.in_stock desc, r.name asc)
      from ranked r
    ), '[]'::json),
    'facets', json_build_object(
      'categories', coalesce((select json_agg(c) from (
        select category as value, count(*)::int as count from base where category is not null
        group by category order by count(*) desc, category asc limit 40) c), '[]'::json),
      'brands', coalesce((select json_agg(b2) from (
        select brand as value, count(*)::int as count from base where brand is not null and brand <> ''
        group by brand order by count(*) desc, brand asc limit 30) b2), '[]'::json),
      'dietary', coalesce((select json_agg(d) from (
        select tag as value, count(*)::int as count from base, unnest(base.dietary) as tag
        group by tag order by count(*) desc, tag asc) d), '[]'::json),
      'allergens', coalesce((select json_agg(a) from (
        select tag as value, count(*)::int as count from base, unnest(base.allergens) as tag
        group by tag order by count(*) desc, tag asc) a), '[]'::json),
      'price', case when p_show_prices then (
        select json_build_object('min', min(price), 'max', max(price)) from base where price is not null
      ) else null end,
      'in_stock', (select count(*)::int from base where in_stock)
    )
  );
$$;
