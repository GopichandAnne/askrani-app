-- ═══════════════════════════════════════════════════════════════════════════
-- 0056 — bound the semantic result set in browse_products()
--
-- 0055 skipped text filtering whenever an embedding was supplied (a semantic
-- match needn't contain the words), which meant a free-text query matched the
-- ENTIRE catalogue: "mini beaker" ranked correctly but reported total = 1160 and
-- built its facets from every product in the store. Ranking was right; the
-- result SET was meaningless.
--
-- A query now selects a bounded candidate pool — everything that matches on text
-- UNION the nearest neighbours by vector — and total/facets describe that pool.
-- With no query, the pool is simply everything the filters allow.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.browse_products(
  p_store_id        uuid,
  p_query           text default null,
  p_query_embedding extensions.vector(768) default null,
  p_categories      text[] default null,
  p_brands          text[] default null,
  p_price_min       numeric default null,
  p_price_max       numeric default null,
  p_in_stock        boolean default null,
  p_skus            text[] default null,
  p_limit           int default 40,
  p_offset          int default 0,
  p_show_prices     boolean default true
)
returns json
language sql
security definer
stable
set search_path = public, extensions
as $$
  with filtered as (
    select p.id, p.sku, p.name, p.brand, p.size, p.unit, p.price, p.currency,
           p.category, p.image_url, p.in_stock, p.embedding
    from public.products p
    where p.store_id = p_store_id
      and (p_categories is null or p.category = any(p_categories))
      and (p_brands     is null or p.brand    = any(p_brands))
      and (p_price_min  is null or p.price   >= p_price_min)
      and (p_price_max  is null or p.price   <= p_price_max)
      and (p_in_stock   is null or p.in_stock = p_in_stock)
      and (p_skus       is null or p.sku      = any(p_skus))
  ),
  -- Candidate pool for a free-text query: literal matches + nearest neighbours.
  cand as (
    select f.id from filtered f
    where p_query is null or p_query = ''
    union
    select f.id from filtered f
    where p_query is not null and p_query <> ''
      and (f.name     ilike '%' || p_query || '%'
        or f.brand    ilike '%' || p_query || '%'
        or f.category ilike '%' || p_query || '%'
        or f.sku      ilike '%' || p_query || '%')
    union
    select v.id from (
      select f.id from filtered f
      where p_query_embedding is not null and f.embedding is not null
      order by f.embedding <=> p_query_embedding
      limit greatest(p_limit + p_offset, 60)
    ) v
  ),
  base as (
    select f.* from filtered f join cand c on c.id = f.id
  ),
  scored as (
    select b.*,
      case when p_query_embedding is not null and b.embedding is not null
           then 1 - (b.embedding <=> p_query_embedding) else 0 end as vscore,
      case when p_query is null or p_query = ''
           then 0 else similarity(coalesce(b.name, ''), p_query) end as tscore
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
        'image_url', r.image_url, 'in_stock', r.in_stock
      ) order by r.score desc, r.in_stock desc, r.name asc)
      from ranked r
    ), '[]'::json),
    'facets', json_build_object(
      'categories', coalesce((
        select json_agg(c) from (
          select category as value, count(*)::int as count
          from base where category is not null
          group by category order by count(*) desc, category asc limit 40
        ) c
      ), '[]'::json),
      'brands', coalesce((
        select json_agg(b2) from (
          select brand as value, count(*)::int as count
          from base where brand is not null and brand <> ''
          group by brand order by count(*) desc, brand asc limit 30
        ) b2
      ), '[]'::json),
      'price', case when p_show_prices then (
        select json_build_object('min', min(price), 'max', max(price))
        from base where price is not null
      ) else null end,
      'in_stock', (select count(*)::int from base where in_stock)
    )
  );
$$;
