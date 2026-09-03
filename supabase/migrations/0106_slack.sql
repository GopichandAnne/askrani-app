-- ═══════════════════════════════════════════════════════════════════════════
-- 0106 — Slack front door. A workspace installs the Rani app (OAuth) → one row in
-- slack_installs maps the Slack team to a store and holds that install's bot token.
-- slack_events dedups Events-API deliveries (Slack retries on any non-2xx / >3s), so
-- a slow LLM turn is never processed twice. Both are service-role only (the edge bot
-- reads/writes them; never a user token).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.slack_installs (
  team_id text primary key,                 -- Slack workspace id (T...)
  store_id uuid not null references public.stores(id) on delete cascade,
  bot_token text not null,                  -- xoxb- token for this install (chat.postMessage, users.info)
  bot_user_id text,
  team_name text,
  installed_by text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists slack_installs_store on public.slack_installs (store_id);

create table if not exists public.slack_events (
  event_id text primary key,                -- Slack event_id — insert-or-skip dedup
  seen_at timestamptz not null default now()
);

alter table public.slack_installs enable row level security;
alter table public.slack_events enable row level security;
-- (no policies: service role bypasses RLS)
