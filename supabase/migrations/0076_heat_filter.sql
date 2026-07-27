-- Structured spice/heat level, so the diner's "spice" control is a real FILTER
-- (find dishes by heat) instead of a fuzzy text search, and Rani can answer
-- "how spicy is this?" honestly. NULL = not applicable / unset (e.g. desserts).
alter table public.products add column if not exists heat text
  check (heat is null or heat in ('mild', 'medium', 'hot'));

-- browse_products v-next: + p_heat filter (match ANY selected level), + heat on
-- each item, + a heat facet. Everything else unchanged. Adding a parameter makes a
-- NEW overload, so drop the prior signature to avoid ambiguous-function errors.
drop function if exists public.browse_products(
  uuid, text, extensions.vector, text[], text[], numeric, numeric, boolean,
  text[], int, int, boolean, text[], text[]
);
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
  p_exclude_allergens text[] default null,
  p_heat              text[] default null
)
returns json
language sql
security definer
stable
set search_path = public, extensions
as $$
  with filtered as (
    select p.id, p.sku, p.name, p.brand, p.size, p.unit, p.price, p.currency,
           p.category, p.image_url, p.in_stock, p.embedding, p.allergens, p.dietary, p.modifiers, p.heat
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
      and (p_heat       is null or p.heat = any(p_heat))
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
        'allergens', r.allergens, 'dietary', r.dietary, 'modifiers', r.modifiers, 'heat', r.heat
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
      'heat', coalesce((select json_agg(h) from (
        select heat as value, count(*)::int as count from base where heat is not null
        group by heat order by count(*) desc) h), '[]'::json),
      'price', case when p_show_prices then (
        select json_build_object('min', min(price), 'max', max(price)) from base where price is not null
      ) else null end,
      'in_stock', (select count(*)::int from base where in_stock)
    )
  );
$$;

grant execute on function public.browse_products(uuid, text, extensions.vector, text[], text[], numeric, numeric, boolean, text[], int, int, boolean, text[], text[], text[]) to service_role, authenticated;

-- search_products also returns heat, so Rani can answer "how spicy is this?" and
-- reason about heat when picking dishes conversationally. Return type changes →
-- drop + recreate (0069 body + one column).
drop function if exists public.search_products(uuid, text, extensions.vector, int, int, int);

create function public.search_products(
  p_store_id        uuid,
  p_query           text,
  p_query_embedding extensions.vector(768),
  p_limit           int default 5,
  p_pool            int default 20,
  p_rrf_k           int default 60
)
returns table (
  id          uuid,
  sku         text,
  name        text,
  brand       text,
  size        text,
  unit        text,
  price       numeric,
  currency    text,
  in_stock    boolean,
  category    text,
  description text,
  image_url   text,
  allergens   text[],
  dietary     text[],
  modifiers   jsonb,
  heat        text,
  score       double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with lexical as (
    select p.id,
           row_number() over (order by similarity(p.name, p_query) desc, p.id) as rnk
    from public.products p
    where p.store_id = p_store_id
      and p.name % p_query
    order by similarity(p.name, p_query) desc, p.id
    limit p_pool
  ),
  semantic as (
    select p.id,
           row_number() over (order by p.embedding <=> p_query_embedding, p.id) as rnk
    from public.products p
    where p.store_id = p_store_id
      and p.embedding is not null
    order by p.embedding <=> p_query_embedding, p.id
    limit p_pool
  ),
  fused as (
    select coalesce(l.id, s.id) as id,
           coalesce(1.0 / (p_rrf_k + l.rnk), 0.0)
         + coalesce(1.0 / (p_rrf_k + s.rnk), 0.0) as score
    from lexical l
    full outer join semantic s on l.id = s.id
  )
  select p.id, p.sku, p.name, p.brand, p.size, p.unit, p.price, p.currency,
         p.in_stock, p.category, p.description, p.image_url, p.allergens, p.dietary,
         p.modifiers, p.heat, f.score
  from fused f
  join public.products p on p.id = f.id
  order by f.score desc, p.name
  limit p_limit;
$$;

grant execute on function public.search_products(uuid, text, extensions.vector, int, int, int)
  to service_role, authenticated;
