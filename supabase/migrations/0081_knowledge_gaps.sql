-- 0081_knowledge_gaps — Lever B: demand-driven enrichment.
--
-- Every time a customer asks Rani something and the knowledge search comes back
-- EMPTY, we log the question here. That's the precise "a shopper wanted to know
-- something we haven't taught Rani yet" moment. The owner-copilot then surfaces
-- these ("5 shoppers asked about catering this week"), and when the owner answers
-- one it becomes a live saved_qa — so the store's knowledge grows exactly where
-- real demand is, one tap at a time.
--
-- Written + read only by the edge functions (service role); RLS on with no client
-- policies keeps it closed to anon/authenticated until a panel screen needs it.

create table if not exists knowledge_gap (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,
  question    text not null,
  session_id  text,
  status      text not null default 'open',   -- open | resolved | dismissed
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- The one hot query: this store's open gaps, newest first.
create index if not exists knowledge_gap_store_status_idx
  on knowledge_gap (store_id, status, created_at desc);

alter table knowledge_gap enable row level security;
-- No client policies on purpose — only the service-role edge functions touch it.
