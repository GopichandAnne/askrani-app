-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 — tables, indexes, updated_at triggers
-- RLS is ENABLED here but policies are defined in 0004. With RLS enabled and no
-- policy, only the service role (BYPASSRLS) can touch a table — a safe default.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── shared updated_at trigger ───────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- stores  (master registry — mirrors Stores Config Sheet)
-- tax_rate / history_turns are NOT columns here: they live in agent_config as
-- the source of truth (Option B). See 0005 seed + note below.
-- ═══════════════════════════════════════════════════════════════════════════
create table public.stores (
  id                          uuid primary key default gen_random_uuid(),
  slug                        text not null unique,
  active                      boolean not null default true,
  store_display_name          text,
  business_type               text,
  business_modes              text,
  product_source              text,
  store_folder_id             text,
  analytics_sheet_id          text,
  details_folder_id           text,
  location_folder_id          text,
  pricing_file_id             text,
  pricing_folder_id           text,
  prompt_file_id              text,
  current_cache_name          text,
  current_cache_expires_at    timestamptz,
  whatsapp_phone_number_id    text,
  whatsapp_waba_id            text,
  whatsapp_status             text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
comment on table public.stores is 'Master store registry. Mirrors Stores Config Sheet. Secrets live in store_secrets, NOT here.';

create trigger trg_stores_updated_at before update on public.stores
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- store_secrets  (service-role ONLY — no client policy ever; see 0004)
-- The Sheet keeps WhatsApp tokens in plaintext; they MUST NOT be client-readable.
-- ═══════════════════════════════════════════════════════════════════════════
create table public.store_secrets (
  store_id                uuid primary key references public.stores(id) on delete cascade,
  whatsapp_access_token   text,
  whatsapp_verify_token   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.store_secrets is 'WhatsApp tokens etc. SERVICE-ROLE ONLY. RLS enabled with NO policies — anon/auth can never SELECT.';

create trigger trg_store_secrets_updated_at before update on public.store_secrets
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- staff  (v2 access model — supersedes legacy Staff sheet token auth)
-- A user may have multiple rows (one per store). Platform admins -> see
-- platform_admins below.
-- ═══════════════════════════════════════════════════════════════════════════
create table public.staff (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  role        public.staff_role not null default 'staff',
  name        text,
  status      public.staff_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, store_id)
);
create index idx_staff_user on public.staff(user_id);
create index idx_staff_store on public.staff(store_id);

create trigger trg_staff_updated_at before update on public.staff
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- platform_admins  (legacy store_slug='*' -> platform admin across all stores)
-- service-role managed; no client policy. Membership grants all-store access via
-- the RLS helper functions in 0003.
-- ═══════════════════════════════════════════════════════════════════════════
create table public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
comment on table public.platform_admins is 'Platform admins (legacy store_slug=*). All-store access. Managed by service role only.';

-- ═══════════════════════════════════════════════════════════════════════════
-- orders  (mirrors per-store Orders sheet)
-- store_slug FKs stores.slug (the mirror keys on slug, not id).
-- ═══════════════════════════════════════════════════════════════════════════
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_id        text not null unique,                 -- <PREFIX>-<YEAR>-<SEQ>
  store_slug      text not null references public.stores(slug) on update cascade,
  customer_phone  text,
  customer_name   text,
  session_id      text,
  timestamp       timestamptz,
  items_json      jsonb not null default '[]'::jsonb,   -- catalog | request variants
  subtotal        numeric,
  currency        text,
  fulfillment     public.fulfillment_type,
  notes           text,                                 -- holds inline audit tags
  status          public.order_status not null default 'placed',
  source_channel  text,
  order_mode      public.order_mode not null default 'standard',
  tax             numeric,                              -- optional
  total           numeric,                              -- optional
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_orders_store_status on public.orders(store_slug, status);
create index idx_orders_customer_phone on public.orders(customer_phone);

create trigger trg_orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- threads  (mirrors `threads` tab in the store's Analytics sheet)
-- ═══════════════════════════════════════════════════════════════════════════
create table public.threads (
  id              uuid primary key default gen_random_uuid(),
  thread_id       text not null unique,                 -- thr_<phone>_<slug>
  store_slug      text not null references public.stores(slug) on update cascade,
  customer_phone  text,
  customer_name   text,
  routing_state   public.routing_state not null default 'idle',
  activated_at    timestamptz,
  activated_by    text,
  resolved_at     timestamptz,
  resolved_by     text,
  last_message_at timestamptz,
  message_count   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_threads_store_lastmsg on public.threads(store_slug, last_message_at desc);

create trigger trg_threads_updated_at before update on public.threads
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- thread_messages  (messages AND events interleaved — APPEND-ONLY audit)
-- Single table powers the Conversations view with inline event chips.
-- Do NOT add a separate order_events table — events live here.
-- ═══════════════════════════════════════════════════════════════════════════
create table public.thread_messages (
  id                  uuid primary key default gen_random_uuid(),
  message_id          text not null unique,             -- msg_... | evt_...
  thread_id           text not null references public.threads(thread_id) on update cascade,
  store_slug          text not null references public.stores(slug) on update cascade,
  customer_phone      text,
  direction           public.message_direction,
  sender              text,                             -- customer | agent | owner_email | system
  text                text,
  wamid               text,                             -- WhatsApp id (nullable)
  related_order_id    text,                             -- nullable, loose ref to orders.order_id
  kind                public.message_kind not null default 'message',
  event_type          text,                             -- nullable; see 0001 note
  event_payload_json  jsonb,
  created_at          timestamptz not null default now()
);
create index idx_tm_store_thread_created on public.thread_messages(store_slug, thread_id, created_at);
create index idx_tm_related_order on public.thread_messages(related_order_id) where related_order_id is not null;
-- dedup on WhatsApp id only where present:
create unique index uq_tm_wamid on public.thread_messages(wamid) where wamid is not null;
comment on table public.thread_messages is 'Append-only. No UPDATE/DELETE policy. Messages + events interleaved.';

-- ═══════════════════════════════════════════════════════════════════════════
-- conversations  (the analytics turn log — mirrors `Conversations` tab)
-- Distinct from thread_messages: dashboards read this.
-- ═══════════════════════════════════════════════════════════════════════════
create table public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     text not null unique,             -- wa-...
  store_slug          text not null references public.stores(slug) on update cascade,
  session_id          text,                             -- wa_<phone>
  timestamp           timestamptz,
  user_message        text,
  assistant_response  text,
  response_time_ms    integer,
  device_type         public.device_type,
  analytics_json      text,                             -- text in Phase 6 (may become jsonb later)
  synced_to_master    boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_conv_store_ts on public.conversations(store_slug, "timestamp" desc);

create trigger trg_conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- carts  (DISPLAY MIRROR ONLY — non-authoritative; cache is the source)
-- ═══════════════════════════════════════════════════════════════════════════
create table public.carts (
  id              uuid primary key default gen_random_uuid(),
  session_id      text not null unique,
  store_slug      text not null references public.stores(slug) on update cascade,
  customer_name   text,
  items           jsonb not null default '[]'::jsonb,   -- catalog | request variants (match orders)
  subtotal        numeric,
  currency        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.carts is 'Best-effort, non-authoritative mirror of the Apps Script CacheService cart. Label as such in UI.';

create trigger trg_carts_updated_at before update on public.carts
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- tickets  (DISPLAY MIRROR ONLY — ephemeral, cache-backed; durable trace is the
-- ticket_resolved event in thread_messages)
-- ═══════════════════════════════════════════════════════════════════════════
create table public.tickets (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       text not null unique,                 -- <PREFIX>-Q-<SEQ>
  store_slug      text not null references public.stores(slug) on update cascade,
  session_id      text,
  customer_phone  text,
  customer_name   text,
  question        text,
  status          public.ticket_status not null default 'created',
  answer          text,
  answered_at     timestamptz,
  answered_by     text,
  saved_to_kb     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_tickets_store_status on public.tickets(store_slug, status);

create trigger trg_tickets_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- saved_qa  (escalation Q&A — KB.gs flat model; owner-managed list)
-- ═══════════════════════════════════════════════════════════════════════════
create table public.saved_qa (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores(id) on delete cascade,
  question        text not null,
  answer          text,
  source_session  text,
  times_used      integer not null default 0,
  last_used       timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  active          boolean not null default true,
  category        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_saved_qa_store on public.saved_qa(store_id);
create index idx_saved_qa_active on public.saved_qa(store_id, active);

create trigger trg_saved_qa_updated_at before update on public.saved_qa
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- agent_config  (Option B: Postgres source of truth; Drive = generated artifact)
-- tax_rate / history_turns live here as keys (NOT as stores columns).
-- ═══════════════════════════════════════════════════════════════════════════
create table public.agent_config (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  key         public.agent_config_key not null,
  value       text,
  version     integer not null default 1,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (store_id, key)
);
create index idx_agent_config_store on public.agent_config(store_id);

create trigger trg_agent_config_updated_at before update on public.agent_config
  for each row execute function public.set_updated_at();

-- append-on-every-save history -> revert capability
create table public.agent_config_history (
  id          uuid primary key default gen_random_uuid(),
  config_id   uuid references public.agent_config(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  key         public.agent_config_key not null,
  value       text,
  version     integer not null,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_agent_config_history_store_key on public.agent_config_history(store_id, key, created_at desc);

-- ── Enable RLS on every table (policies in 0004). ───────────────────────────
alter table public.stores                enable row level security;
alter table public.store_secrets         enable row level security;
alter table public.staff                 enable row level security;
alter table public.platform_admins       enable row level security;
alter table public.orders                enable row level security;
alter table public.threads               enable row level security;
alter table public.thread_messages       enable row level security;
alter table public.conversations         enable row level security;
alter table public.carts                 enable row level security;
alter table public.tickets               enable row level security;
alter table public.saved_qa              enable row level security;
alter table public.agent_config          enable row level security;
alter table public.agent_config_history  enable row level security;
