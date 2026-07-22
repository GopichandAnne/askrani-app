-- ═══════════════════════════════════════════════════════════════════════════
-- 0059 — Co-marketing rewards engine (Increment 1: credit engine + give-and-get)
--
-- The net-new spine for the co-marketing module. There is no promotions engine
-- to extend (store_charges only ADDS fees), so credit/redemption is built fresh.
--
-- Increment 1 scope (this migration): the credit + redemption ledger, the
-- give-and-get referral loop (links + attribution + reward-on-real-order), and
-- the in-store redemption pass. Post-for-credit, the opportunities board,
-- social bindings and influencer briefs land in later increments.
--
-- Money is stored as INTEGER CENTS everywhere (money-like precision; never float).
-- The ledger is append-only + status transitions — balance is DERIVED, never a
-- stored mutable number (see reward_balance() in the engine module).
--
-- All tables are RLS-on, deny-by-default, SERVICE-ROLE ONLY (edge functions +
-- bot-admin write; the panel reads server-side via the admin client), exactly
-- like store_members (0041) and store_charges (0053). No anon/authenticated
-- policies. STOP for human review before `supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════════

-- A staff member who may ONLY confirm redemptions (no campaigns/budgets/members).
-- Unused in this migration's DDL; safe to add in-txn on PG15 as long as unused.
alter type public.staff_role add value if not exists 'redemption';

-- ── enums ────────────────────────────────────────────────────────────────────
create type public.reward_campaign_status as enum ('draft','active','paused','ended');
create type public.reward_trigger        as enum ('referral_first_order','referral_order','ugc_post','influencer');
create type public.reward_kind           as enum ('store_credit','free_item');
create type public.reward_amount_model   as enum ('flat','percent','tier');
create type public.reward_event_status   as enum ('accrued','capped','reversed');
create type public.reward_ledger_status  as enum ('pending','held','released','redeemed','expired','reversed');
create type public.redemption_surface    as enum ('qr','panel_code','phone_lookup');
create type public.redemption_pass_status as enum ('active','confirmed','expired','cancelled');
create type public.attribution_type      as enum ('link_click','chat_started','first_order','repeat_order');

-- ── store_members extensions (identity = extend in place; a "contact" is a
--    store_member row, possibly lightweight/unverified, auto-created on 1st touch)
alter table public.store_members
  add column if not exists referred_by     uuid references public.store_members(id) on delete set null,
  add column if not exists ig_handle       text,
  add column if not exists social_optin_at timestamptz;
create index if not exists store_members_referred_by_idx
  on public.store_members(referred_by) where referred_by is not null;

-- ── reward_campaigns ─────────────────────────────────────────────────────────
create table public.reward_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null references public.stores(id) on delete cascade,
  name                  text not null,
  preset                text,                       -- 'fill_slow_days'|'launch_buzz'|'build_regulars'
  status                public.reward_campaign_status not null default 'draft',
  channel_flags         jsonb not null default '{"share_card":true}'::jsonb,
  budget_cap_cents      integer,                    -- null = uncapped (discouraged)
  budget_spent_cents    integer not null default 0, -- running tally of released+redeemed accruals
  per_poster_cap_cents  integer,
  hold_hours            integer not null default 72 check (hold_hours >= 24),
  credit_expiry_days    integer not null default 90,
  attribution_window_days integer not null default 30,
  tier_config           jsonb not null default '{}'::jsonb,
  starts_at             timestamptz,
  ends_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index reward_campaigns_store_idx on public.reward_campaigns(store_id);
create index reward_campaigns_active_idx on public.reward_campaigns(store_id) where status = 'active';
create trigger trg_reward_campaigns_updated_at before update on public.reward_campaigns
  for each row execute function public.set_updated_at();

-- ── reward_rules — the amount matrix (Increment 1 uses the referral_* triggers)
create table public.reward_rules (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.reward_campaigns(id) on delete cascade,
  trigger       public.reward_trigger not null,
  platform      text,                              -- 'whatsapp'|'instagram'|'youtube'|null
  format        text,                              -- 'card'|'post'|'reel'|'story'|'video'|null
  product_sku   text,                              -- null = default; else per-item weight [FWD-COMPAT]
  reward_kind   public.reward_kind not null default 'store_credit',
  amount_model  public.reward_amount_model not null default 'flat',
  amount_cents  integer,                           -- flat
  percent_bps   integer,                           -- percent of net order, basis points (500 = 5%)
  tiers         jsonb,                             -- [{min_reach,max_reach,amount_cents}]
  min_order_cents integer not null default 0,
  -- give-and-get: the recipient's coupon (issued to the referred contact)
  recipient_kind         public.reward_kind,
  recipient_amount_cents integer,
  recipient_min_order_cents integer not null default 0,
  recipient_expiry_days  integer not null default 14,
  conditions    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index reward_rules_campaign_idx on public.reward_rules(campaign_id);

-- ── referral_links — one per initiator per campaign; code survives every forward
create table public.referral_links (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.reward_campaigns(id) on delete cascade,
  initiator_member_id uuid not null references public.store_members(id) on delete cascade,
  code                text not null unique,        -- short slug in /r/<code>
  destination_type    text not null default 'wa_deeplink', -- 'wa_deeplink'|'web_chat'
  card_image_ref      text,                        -- storage path of the composed card
  created_at          timestamptz not null default now(),
  unique (campaign_id, initiator_member_id)
);
create index referral_links_campaign_idx on public.referral_links(campaign_id);

-- ── attribution_events — clicks + downstream funnel (never the invisible forward)
create table public.attribution_events (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.reward_campaigns(id) on delete cascade,
  referral_link_id uuid references public.referral_links(id) on delete set null,
  member_id        uuid references public.store_members(id) on delete set null, -- the referred contact
  type             public.attribution_type not null,
  dedupe_hash      text,                            -- device-fingerprint + IP (24h window)
  geo_city         text,                            -- city-level only; never precise
  occurred_at      timestamptz not null default now()
);
create index attribution_events_campaign_idx on public.attribution_events(campaign_id);
create index attribution_events_link_idx on public.attribution_events(referral_link_id);
-- Click dedup is a ROLLING 24h window (not a day-bucket), so it can't be a static
-- unique index — and a timestamptz::date cast isn't IMMUTABLE anyway. The link
-- resolver enforces it: skip inserting a link_click if one exists for the same
-- (link, dedupe_hash) within the last 24h. This index makes that lookup fast.
create index attribution_events_dedupe_idx
  on public.attribution_events(referral_link_id, dedupe_hash, occurred_at)
  where type = 'link_click' and dedupe_hash is not null;

-- ── reward_events — the accrual fact (immutable except status); idempotent per source
create table public.reward_events (
  id                   uuid primary key default gen_random_uuid(),
  campaign_id          uuid not null references public.reward_campaigns(id) on delete cascade,
  member_id            uuid not null references public.store_members(id) on delete cascade,
  source_type          text not null,               -- 'referral_order' (Inc1) | 'ugc_post' | 'influencer'
  source_id            text not null,               -- e.g. the order id that triggered it
  product_sku          text,                         -- [FWD-COMPAT]
  funding_source       text not null default 'store',-- 'store' | 'supplier:<id>'  [FWD-COMPAT]
  tier                 text,
  computed_amount_cents integer not null,
  status               public.reward_event_status not null default 'accrued',
  flags                jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  -- one accrual per (campaign, source) — prevents double-rewarding the same order
  unique (campaign_id, source_type, source_id)
);
create index reward_events_member_idx on public.reward_events(member_id);

-- ── reward_ledger — the money lifecycle; balance is DERIVED from this table
create table public.reward_ledger (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores(id) on delete cascade,
  member_id        uuid not null references public.store_members(id) on delete cascade,
  campaign_id      uuid references public.reward_campaigns(id) on delete set null,
  reward_event_id  uuid unique references public.reward_events(id) on delete set null, -- idempotent
  amount_cents     integer not null,
  kind             public.reward_kind not null default 'store_credit',
  status           public.reward_ledger_status not null default 'pending',
  hold_until       timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index reward_ledger_member_idx on public.reward_ledger(store_id, member_id);
create index reward_ledger_release_idx on public.reward_ledger(hold_until) where status = 'held';
create index reward_ledger_expiry_idx on public.reward_ledger(expires_at) where status = 'released';
create trigger trg_reward_ledger_updated_at before update on public.reward_ledger
  for each row execute function public.set_updated_at();

-- ── redemption_passes — time-boxed code+QR staff confirm; expiry never burns credit
create table public.redemption_passes (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  member_id    uuid not null references public.store_members(id) on delete cascade,
  code4        text not null,                       -- 4-digit, shown to the customer
  qr_token     text not null unique,                -- opaque token in the QR
  amount_cents integer not null,
  first_name   text,
  status       public.redemption_pass_status not null default 'active',
  surface      public.redemption_surface,           -- set on confirmation
  staff_id     uuid references public.staff(id) on delete set null,
  expires_at   timestamptz not null,                -- ~15 min
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index redemption_passes_member_idx on public.redemption_passes(store_id, member_id);
create index redemption_passes_active_idx on public.redemption_passes(store_id) where status = 'active';
-- fast staff lookup by the 4-digit code among currently-active passes
create index redemption_passes_code_idx on public.redemption_passes(store_id, code4) where status = 'active';

-- ── reward_redemptions — the settlement record (one per applied redemption)
create table public.reward_redemptions (
  id             uuid primary key default gen_random_uuid(),
  ledger_id      uuid not null references public.reward_ledger(id) on delete cascade,
  pass_id        uuid references public.redemption_passes(id) on delete set null,
  order_ref      text,                              -- POS bill / Rani order id
  amount_cents   integer not null,                  -- amount actually redeemed
  remainder_cents integer not null default 0,       -- credit left on the ledger row (partial)
  redeemed_at    timestamptz not null default now()
);
create index reward_redemptions_ledger_idx on public.reward_redemptions(ledger_id);

-- ── RLS: on, deny-by-default, service-role only (panel reads via admin client) ──
alter table public.reward_campaigns   enable row level security;
alter table public.reward_rules        enable row level security;
alter table public.referral_links      enable row level security;
alter table public.attribution_events  enable row level security;
alter table public.reward_events       enable row level security;
alter table public.reward_ledger       enable row level security;
alter table public.redemption_passes   enable row level security;
alter table public.reward_redemptions  enable row level security;

comment on table public.reward_ledger is
  'Append-only credit ledger. Balance = sum(released)-sum(redeemed) per (store,member); never store a mutable balance. Redemption row-locks the ledger + pass rows to prevent double-spend.';
