-- Members-only knowledge — Bot Phase 3i.
-- A document can be marked visible ONLY to a signed-in member. Retrieval
-- (search_knowledge) hides members_only chunks unless the chat session is bound
-- to a verified member, so gated content (member pricing, account policies,
-- internal how-tos) never surfaces for an anonymous visitor. Public by default.

alter table public.knowledge_index
  add column if not exists members_only boolean not null default false;

-- Signature change -> drop + recreate, adding p_is_member (defaults false, so any
-- existing 4-arg named call still resolves and simply sees only public chunks).
drop function if exists public.search_knowledge(uuid, extensions.vector, int, date);

create or replace function public.search_knowledge(
  p_store_id        uuid,
  p_query_embedding extensions.vector(768),
  p_limit           int     default 4,
  p_today           date    default null,
  p_is_member       boolean default false
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
    and (not k.members_only or p_is_member)
  order by k.embedding <=> p_query_embedding
  limit p_limit;
$$;

grant execute on function public.search_knowledge(uuid, extensions.vector, int, date, boolean)
  to service_role, authenticated;
