-- ═══════════════════════════════════════════════════════════════════════════
-- 0015 — knowledge_index: one semantic store for RAG (Bot Phase 3b)
--
-- Rebuild of KnowledgeBase.gs, natively. Documents (policies, FAQs, guides) are
-- chunked + embedded; saved_qa rows are embedded as single units. Both live here
-- under a `kind` discriminator and are retrieved by cosine similarity via the
-- search_knowledge RPC (0016) — the second tool on the same function-calling
-- loop. This is why saved_qa was pulled out of the prompt prefix in 3a.
--
-- Same embedding space as products: gemini-embedding-001, 768d, L2-normalized.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.knowledge_index (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  kind          text not null,                 -- 'document_chunk' | 'saved_qa'
  source_ref    text,                          -- document title/name | saved_qa id
  chunk_index   integer not null default 0,    -- ordinal within a document
  chunk_text    text not null,                 -- the retrievable unit
  token_count   integer,
  embedding     extensions.vector(768),
  embedding_stale boolean not null default true,
  embedded_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_knowledge_store on public.knowledge_index(store_id);
create index idx_knowledge_source on public.knowledge_index(store_id, kind, source_ref);
create index idx_knowledge_stale on public.knowledge_index(store_id) where embedding_stale;
create index idx_knowledge_embedding_hnsw
  on public.knowledge_index using hnsw (embedding extensions.vector_cosine_ops);

create trigger trg_knowledge_updated_at before update on public.knowledge_index
  for each row execute function public.set_updated_at();

-- ── RLS: store members read; owners write (KB is owner-curated, like saved_qa).
-- The bot reads/writes via service_role (BYPASSRLS). Ingestion runs service-role
-- (bot-admin), so no authenticated INSERT policy is needed yet; the panel's
-- paste-text path will POST through an owner-gated server route (Phase 3b UI).
alter table public.knowledge_index enable row level security;

create policy knowledge_select on public.knowledge_index
  for select to authenticated
  using (store_id in (select public.user_store_ids()));

grant select on public.knowledge_index to authenticated;
grant select, insert, update, delete on public.knowledge_index to service_role;
