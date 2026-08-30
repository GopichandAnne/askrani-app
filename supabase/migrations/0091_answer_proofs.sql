-- ═══════════════════════════════════════════════════════════════════════════
-- 0091 — answer-engine proof receipts (Proof B)
--
-- Verbatim, timestamped record of what a live answer engine (Perplexity) says
-- about a business, before and after publishing its Answers page. The console
-- shows the before→after so an invisible AEO win becomes evidenced. Written and
-- read only by the console via the service role (RLS on, no policies).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.answer_proofs (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  question    text not null,
  engine      text not null default 'perplexity',
  phase       text not null,                       -- 'before' | 'after'
  answered    boolean not null default false,      -- did the engine actually answer
  cited       boolean not null default false,      -- did it cite the business / Answers page
  answer_text text,
  citations   jsonb not null default '[]'::jsonb,
  checked_at  timestamptz not null default now()
);
create index if not exists answer_proofs_store_idx on public.answer_proofs(store_id, checked_at desc);

alter table public.answer_proofs enable row level security;
-- No policies: written/read by the console through the service role only.
