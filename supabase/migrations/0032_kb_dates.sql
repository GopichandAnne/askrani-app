-- Date-based KB entries — Bot Phase 3h.
-- A document can carry an effective window. Retrieval (search_knowledge) hides
-- chunks outside [valid_from, valid_until] using the STORE-LOCAL date passed in,
-- so a weekend flyer or a holiday-hours notice auto-activates and auto-expires
-- with no one deleting it. Null on either side = open-ended (always valid).

alter table public.knowledge_index
  add column if not exists valid_from  date,
  add column if not exists valid_until date;

-- Signature + return shape change -> drop then recreate (adds p_today + the
-- validity columns). Existing 3-arg named calls still resolve (p_today defaults).
drop function if exists public.search_knowledge(uuid, extensions.vector, int);

create or replace function public.search_knowledge(
  p_store_id        uuid,
  p_query_embedding extensions.vector(768),
  p_limit           int  default 4,
  p_today           date default null
)
returns table (
  kind        text,
  source_ref  text,
  chunk_text  text,
  valid_from  date,
  valid_until date,
  distance    double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select k.kind, k.source_ref, k.chunk_text, k.valid_from, k.valid_until,
         (k.embedding <=> p_query_embedding)::double precision as distance
  from public.knowledge_index k
  where k.store_id = p_store_id
    and k.embedding is not null
    and (k.valid_from  is null or k.valid_from  <= coalesce(p_today, current_date))
    and (k.valid_until is null or k.valid_until >= coalesce(p_today, current_date))
  order by k.embedding <=> p_query_embedding
  limit p_limit;
$$;

grant execute on function public.search_knowledge(uuid, extensions.vector, int, date)
  to service_role, authenticated;
