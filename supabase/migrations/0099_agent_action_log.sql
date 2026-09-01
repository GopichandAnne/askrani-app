-- Agent action log — the trust surface for agentic tool-use.
-- Records every action Rani takes through a tool: which tool, whether it was a
-- write (side_effect), success/failure, and — crucially — WHO it acted as when a
-- tool forwards the signed-in customer's identity ("acted_as"). This is what lets
-- an owner (and their security reviewer) answer "what did the agent do as this
-- user?" — the make-or-break question for delegated-identity tool-calling.
-- No credentials or raw tool args are stored; the model never sees the token, and
-- this log never persists it either.
-- Written best-effort by the chat engine; read-only owner surface. Service-role
-- only (RLS on, no policies).

create table if not exists public.agent_action_log (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  session_id   text,
  ts           timestamptz not null default now(),
  tool         text not null,                 -- the tool name Rani called
  kind         text not null,                 -- 'http' | 'mcp' | 'connector'
  acted_as     text,                          -- signed-in customer's email/id when identity-forwarded; null = acted as the store
  side_effect  boolean not null default false,-- true = it performed an action (a write), not just a read
  status       text not null default 'ok'     -- 'ok' | 'error'
);
create index if not exists agent_action_log_store_ts_idx on public.agent_action_log (store_id, ts desc);

alter table public.agent_action_log enable row level security;
