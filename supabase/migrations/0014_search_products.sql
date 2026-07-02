-- ═══════════════════════════════════════════════════════════════════════════
-- 0014 — search_products: hybrid lexical + semantic retrieval (Bot Phase 3a)
--
-- Two rankers fused by Reciprocal Rank Fusion (RRF):
--   lexical  : pg_trgm similarity(name, query)      -> typos, substrings, exact-ish
--   semantic : embedding <=> query_embedding (cosine)-> meaning ("something for a cold")
--   fuse     : score = Σ 1/(k + rank)  (k=60)         -> rank-based, no score-scale mix
--
-- RRF is rank-based on purpose: trgm similarity (0..1, higher better) and cosine
-- distance (0..2, lower better) live on different scales, so a weighted score sum
-- would be fragile. Ranks compose cleanly.
--
-- The query embedding is computed by the caller (bot: gemini-embedding-001,
-- RETRIEVAL_QUERY, 768d, normalized) and passed in — so this is ONE round-trip.
-- Out-of-stock rows are returned (with the flag), not filtered, so Rani can say
-- "we carry it, currently out" instead of "we don't have it".
--
-- SECURITY INVOKER; the bot calls it as service_role (BYPASSRLS). search_path
-- includes extensions so `%`, `<=>`, similarity() resolve.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.search_products(
  p_store_id        uuid,
  p_query           text,
  p_query_embedding extensions.vector(768),
  p_limit           int default 5,
  p_pool            int default 20,
  p_rrf_k           int default 60
)
returns table (
  id        uuid,
  sku       text,
  name      text,
  brand     text,
  size      text,
  unit      text,
  price     numeric,
  currency  text,
  in_stock  boolean,
  category  text,
  score     double precision
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
      and p.name % p_query               -- trgm similarity above pg_trgm.similarity_threshold
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
         p.in_stock, p.category, f.score
  from fused f
  join public.products p on p.id = f.id
  order by f.score desc, p.name
  limit p_limit;
$$;

grant execute on function public.search_products(uuid, text, extensions.vector, int, int, int)
  to service_role, authenticated;
