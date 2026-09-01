-- ═══════════════════════════════════════════════════════════════════════════
-- 0101 — action_request: the hold → ticket → notify queue.
--
-- When an owner sets a WRITE tool's action_policy to 'hold' (migration 0100),
-- Rani may NOT perform it. Until now that hold just returned a soft note and
-- vanished — nothing was recorded, no one was told. This table closes that loop:
-- every held action becomes a durable APPROVAL REQUEST a person can see, with the
-- full context (which tool, what was asked, who Rani was acting as), and a
-- pending → approved | declined lifecycle the owner resolves from the console.
--
-- This is what makes the governance promise literally true: "I've opened a
-- request and flagged it for your team — nothing's changed." The request exists,
-- the team is notified (topic 'approval'), and the write never ran.
--
-- No credentials or tokens are ever stored (same rule as agent_action_log); a
-- delegated-identity hold records a human label ("acted_as"), never the token.
-- Service-role only (the chat engine writes; the owner console reads/decides via
-- the admin client). RLS on, no anon/authenticated policies.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.action_request (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  session_id  text,
  tool        text not null,                    -- the held tool's name
  kind        text not null,                    -- 'http' | 'mcp'
  acted_as    text,                             -- signed-in customer's label when identity-forwarded; null = the account
  detail      text not null default '',         -- human summary of what was requested (tool + compact args)
  status      text not null default 'pending',  -- 'pending' | 'approved' | 'declined'
  decided_by  text,                             -- who resolved it (owner/staff display name or email)
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists action_request_store_status_idx
  on public.action_request (store_id, status, created_at desc);

alter table public.action_request enable row level security; -- service-role + console admin client only
