-- 0069 — search_products returns modifiers too, so the assistant can offer options
-- conversationally ("Regular or Large?") and pass the chosen option ids to
-- add_to_cart. Return type changes → drop + recreate (0067 body + one column).

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
         p.modifiers, f.score
  from fused f
  join public.products p on p.id = f.id
  order by f.score desc, p.name
  limit p_limit;
$$;

grant execute on function public.search_products(uuid, text, extensions.vector, int, int, int)
  to service_role, authenticated;
