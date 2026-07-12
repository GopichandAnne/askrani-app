-- ═══════════════════════════════════════════════════════════════════════════
-- 0047 — generic "requests" + topic subscriptions (replaces careers-specific 0046)
--
-- A store defines any number of REQUEST TYPES (e.g. "Career interest",
-- "Callback", "Quote request") — each is just a key + label + the fields to
-- collect. The bot exposes one built-in `file_request` tool; which types exist
-- and when to file them is per-store config, so nothing in the core is
-- use-case-specific. Every filed request lands in `requests`.
--
-- Notifications are topic-based: a responder subscribes to any set of topics
-- (store_responders.topics), where a topic is a request-type key OR a built-in
-- ('order', 'escalation'). notifyResponders now fans out by topic. The old
-- notify_orders / notify_escalations booleans are backfilled into topics and
-- left in place (unused) for one release.
--
-- Service-role only (bot core writes requests, bot-admin reads/manages). No
-- anon/authenticated policies.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Per-store request-type definitions ──────────────────────────────────────
create table if not exists public.request_types (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  key         text not null,                       -- machine key = notification topic (e.g. career_interest)
  label       text not null,                       -- human label (e.g. Career interest)
  description text,                                 -- guidance the bot reads: when to file + how to ask
  fields      jsonb not null default '[]'::jsonb,   -- [{key,label,required}] info to collect
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (store_id, key)
);
create index if not exists request_types_store_idx on public.request_types (store_id) where enabled;
alter table public.request_types enable row level security; -- service-role + bot-admin only

-- ── Generic captured requests ───────────────────────────────────────────────
create table if not exists public.requests (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  type          text not null,                     -- request_types.key
  fields        jsonb not null default '{}'::jsonb, -- collected {key: value}
  contact_email text,
  contact_phone text,
  session_id    text,
  status        text not null default 'new',       -- new | reviewed | contacted | closed
  created_at    timestamptz not null default now()
);
create index if not exists requests_store_idx on public.requests (store_id, created_at desc);
alter table public.requests enable row level security; -- service-role + bot-admin only

-- ── Topic subscriptions on responders ───────────────────────────────────────
alter table public.store_responders
  add column if not exists topics text[] not null default '{}';

-- Backfill the two legacy booleans into topic subscriptions.
update public.store_responders
set topics = (
  select coalesce(array_agg(t), '{}')
  from unnest(array[
    case when notify_orders      then 'order'      end,
    case when notify_escalations then 'escalation' end
  ]) as t
  where t is not null
)
where topics = '{}';

-- ── Retire the careers-specific table (0046). It was brand-new; move to generic. ──
drop table if exists public.career_requests;
