-- ═══════════════════════════════════════════════════════════════════════════
-- 0055 — browse_products(): one faceted, paginated, gate-aware catalogue read
--
-- Shared by every browsing surface so they cannot drift apart:
--   • the web grid's filter rail
--   • the chat's show_products tool (chat result -> filtered grid)
--   • the WhatsApp list / signed browse links
--
-- Ranking: hybrid when an embedding is passed (semantic + trigram), plain
-- filter + name order otherwise — so "kratom capsules under $30" and a bare
-- "show me Glass Water Pipes" both work through one entry point.
--
-- p_show_prices is the SERVER's decision (the caller resolves membership first
-- and passes the answer). Execute is granted to service_role ONLY: the edge
-- functions decide who may see prices; a browser can never ask for them itself.
--
-- Facets are computed over the filtered set so counts always match what the
-- grid is about to show.
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
  with base as (
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
      and (
        p_query is null or p_query = ''
        or p.name     ilike '%' || p_query || '%'
        or p.brand    ilike '%' || p_query || '%'
        or p.category ilike '%' || p_query || '%'
        or p.sku      ilike '%' || p_query || '%'
        -- a semantic query need not match any text at all
        or p_query_embedding is not null
      )
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

revoke all on function public.browse_products(uuid, text, extensions.vector, text[], text[], numeric, numeric, boolean, text[], int, int, boolean) from public;
grant execute on function public.browse_products(uuid, text, extensions.vector, text[], text[], numeric, numeric, boolean, text[], int, int, boolean)
  to service_role;
