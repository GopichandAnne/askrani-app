-- End-user identity + access control. A store keeps a directory of its own end
-- users (residents, members, VIPs…), can gate the agent by membership, block
-- specific people, and let a member's ROLE drive the agent's context.
--
-- Identity per channel: WhatsApp = the sender's phone; web = an email the visitor
-- verifies (bound to their session in member_sessions).

alter table public.stores
  add column if not exists access_control text not null default 'open';
-- 'open'     = anyone chats (public context)
-- 'optional' = anyone chats; a verified member gets their role + context
-- 'required' = only a verified member may use the agent at all

create table if not exists public.store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text,
  phone text,                    -- E.164, matched against the WhatsApp sender
  role text not null default 'member',
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  blocked boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists store_members_store_idx on public.store_members(store_id);
create unique index if not exists store_members_email_uq
  on public.store_members(store_id, lower(email)) where email is not null;
create unique index if not exists store_members_phone_uq
  on public.store_members(store_id, phone) where phone is not null;

-- A web chat session bound to a verified member (set after email verification).
create table if not exists public.member_sessions (
  session_id text primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  member_id uuid not null references public.store_members(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists member_sessions_member_idx on public.member_sessions(member_id);

-- RLS on (deny by default). Managed by store owners through owner-gated server
-- actions using the service-role admin client; the edge functions read/write via
-- service role too. No anon/authenticated policies needed.
alter table public.store_members enable row level security;
alter table public.member_sessions enable row level security;
