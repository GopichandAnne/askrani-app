-- ═══════════════════════════════════════════════════════════════════════════
-- 0016 — search_knowledge: semantic RAG retrieval (Bot Phase 3b)
--
-- Pure cosine-similarity top-K over knowledge_index (documents + saved_qa). No
-- lexical half here (unlike products): KB queries are meaning-first ("what's
-- your return policy") and the corpus is small, so semantic alone is the right
-- tool. The caller embeds the query (gemini-embedding-001, RETRIEVAL_QUERY,
-- 768d, normalized) and passes it in — one round-trip.
--
-- Returns a cosine distance so the caller/model can gauge confidence; only rows
-- with an embedding are considered.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.search_knowledge(
  p_store_id        uuid,
  p_query_embedding extensions.vector(768),
  p_limit           int default 4
)
returns table (
  kind        text,
  source_ref  text,
  chunk_text  text,
  distance    double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select k.kind, k.source_ref, k.chunk_text,
         (k.embedding <=> p_query_embedding)::double precision as distance
  from public.knowledge_index k
  where k.store_id = p_store_id
    and k.embedding is not null
  order by k.embedding <=> p_query_embedding
  limit p_limit;
$$;

grant execute on function public.search_knowledge(uuid, extensions.vector, int)
  to service_role, authenticated;
