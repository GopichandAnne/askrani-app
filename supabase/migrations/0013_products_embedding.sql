-- ═══════════════════════════════════════════════════════════════════════════
-- 0013 — product vector/lexical search infra (Bot Phase 3a)
--
-- Hybrid product retrieval = pg_trgm (lexical) + pgvector (semantic), fused in
-- the search_products RPC (0014). This migration adds the columns + indexes and
-- the incremental-reindex plumbing.
--
-- Scale target: ~20K products/store. HNSW is sublinear (built for millions), so
-- query latency stays ~1-3ms at 20K; the trgm GIN is likewise a few ms. What
-- scales with catalog size is INDEXING, handled incrementally via embedding_stale.
--
-- pgvector / pg_trgm live in the `extensions` schema on Supabase (hosted + local
-- stack). We fully-qualify the type + opclasses so DDL resolves regardless of the
-- migration's search_path.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists vector  with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ── columns ─────────────────────────────────────────────────────────────────
-- embedding        : gemini-embedding-001 @ 768 dims (MRL-truncated, L2-normalized)
-- embedding_stale  : true when the embedding needs (re)computing. New rows start
--                    stale; the trigger below re-stales on relevant edits.
-- embedded_at      : when the current embedding was written (observability).
alter table public.products
  add column if not exists embedding       extensions.vector(768),
  add column if not exists embedding_stale  boolean not null default true,
  add column if not exists embedded_at      timestamptz;

-- ── indexes ─────────────────────────────────────────────────────────────────
create index if not exists idx_products_name_trgm
  on public.products using gin (name extensions.gin_trgm_ops);

-- HNSW cosine. Fine to build empty; it fills as rows get embedded.
create index if not exists idx_products_embedding_hnsw
  on public.products using hnsw (embedding extensions.vector_cosine_ops);

-- partial index so the reindex "find stale rows" scan is cheap even at 20K
create index if not exists idx_products_embedding_stale
  on public.products (store_id) where embedding_stale;

-- ── incremental reindex trigger ─────────────────────────────────────────────
-- Re-stale ONLY when embed-relevant text changes. The indexer's own UPDATE
-- (embedding + embedding_stale=false, name unchanged) does not trip this, so
-- there's no re-stale loop. in_stock/verified/price toggles don't re-embed.
create or replace function public.mark_product_embedding_stale()
returns trigger
language plpgsql
as $$
begin
  if new.name     is distinct from old.name
     or new.brand    is distinct from old.brand
     or new.category is distinct from old.category
     or new.size     is distinct from old.size
     or new.unit     is distinct from old.unit then
    new.embedding_stale := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_embedding_stale on public.products;
create trigger trg_products_embedding_stale
  before update on public.products
  for each row
  execute function public.mark_product_embedding_stale();
