-- ═══════════════════════════════════════════════════════════════════════════
-- 0080 — usage metering + credit wallet (Rani side of the shared umbrella wallet)
--
-- Rani becomes the account + billing hub. The chatbot (and every other AI action)
-- is currently UN-metered; this lays the foundation to record real COGS per action
-- and debit a per-store credit wallet — mirroring how Ask Rani Insights records
-- provider_run cost then maps it to credits.
--
-- Phase 1 is RECORD-ONLY: every cost-bearing call writes one usage_event and
-- debits the wallet, but nothing here blocks the bot (the app never gates on
-- balance yet). The wallet may go negative — that's intentional, so we can
-- calibrate real per-store burn against the 150-credit trial before enforcing.
--
-- Three tables + one atomic RPC + auto-provisioning on store creation.
--   • usage_event   — the raw COGS ledger (like Insights.provider_run): one row
--                     per metered call, storing the RAW UNITS (tokens/chars) so
--                     cost can be RE-PRICED historically from a central table.
--   • wallet        — one per store: plan + credit buckets + lifetime totals.
--   • wallet_ledger — human-readable credit movements (grants + debits).
--   • meter_record()— SECURITY DEFINER: insert the usage_event AND debit the
--                     wallet atomically (no read-modify-write race).
--
-- Service-role only (RLS enabled, NO client policies) — same posture as
-- store_charges/store_secrets. The owner-facing balance/usage read is a
-- server-side admin read, added with the UI in a later phase.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── wallet: one credit purse per store ────────────────────────────────────────
create table if not exists public.wallet (
  store_id        uuid primary key references public.stores(id) on delete cascade,
  plan            text not null default 'free',        -- 'free'|'starter'|'growth'|'pro'
  plan_credits    int  not null default 0,             -- resets each billing period
  topup_credits   int  not null default 0,             -- persists (trial + purchased)
  trial_granted   boolean not null default false,
  status          text not null default 'active',
  total_spent     bigint not null default 0,           -- lifetime credits spent
  total_cost_usd  numeric(14,6) not null default 0,     -- lifetime real COGS
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.wallet enable row level security; -- service-role only

-- ── wallet_ledger: every credit grant / debit, newest-first per store ─────────
create table if not exists public.wallet_ledger (
  id        bigint generated always as identity primary key,
  store_id  uuid not null references public.stores(id) on delete cascade,
  ts        timestamptz not null default now(),
  delta     int  not null,                 -- +grant / -debit
  bucket    text not null,                 -- 'plan'|'topup'|'mixed'
  reason    text not null,                 -- the usage kind, or 'trial_grant' etc.
  cost_usd  numeric(14,6),
  ref       jsonb
);
create index if not exists wallet_ledger_store_ts on public.wallet_ledger (store_id, ts desc);
alter table public.wallet_ledger enable row level security; -- service-role only

-- ── usage_event: the raw COGS ledger (store the UNITS, price centrally) ────────
create table if not exists public.usage_event (
  id        bigint generated always as identity primary key,
  store_id  uuid not null references public.stores(id) on delete cascade,
  ts        timestamptz not null default now(),
  kind      text not null,                 -- 'bot_chat'|'search_embed'|'catalog_extract'|'tts'|...
  provider  text,                          -- 'gemini'|'openai'
  model     text,
  units     jsonb not null default '{}'::jsonb, -- {inputTokens,outputTokens,cachedTokens,chars,items,...}
  cost_usd  numeric(14,6) not null default 0,
  credits   int not null default 0,
  ref       jsonb
);
create index if not exists usage_event_store_ts   on public.usage_event (store_id, ts desc);
create index if not exists usage_event_store_kind on public.usage_event (store_id, kind);
alter table public.usage_event enable row level security; -- service-role only

-- ── meter_record: atomically record one metered call + debit the wallet ───────
-- Debits plan credits first, then top-up. RECORD-ONLY: allows the balance to go
-- negative (no clamp) so we never silently drop cost during calibration.
create or replace function public.meter_record(
  p_store_id  uuid,
  p_kind      text,
  p_provider  text,
  p_model     text,
  p_units     jsonb,
  p_cost_usd  numeric,
  p_credits   int,
  p_ref       jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_plan int;
begin
  -- ensure a wallet exists even if the store predates the trigger/backfill
  insert into public.wallet (store_id) values (p_store_id)
    on conflict (store_id) do nothing;

  insert into public.usage_event (store_id, kind, provider, model, units, cost_usd, credits, ref)
    values (p_store_id, p_kind, p_provider, p_model,
            coalesce(p_units, '{}'::jsonb), coalesce(p_cost_usd, 0), coalesce(p_credits, 0), p_ref);

  if coalesce(p_credits, 0) > 0 then
    select least(w.plan_credits, p_credits) into v_from_plan
      from public.wallet w where w.store_id = p_store_id;
    v_from_plan := coalesce(v_from_plan, 0);

    update public.wallet w set
      plan_credits   = w.plan_credits  - v_from_plan,
      topup_credits  = w.topup_credits - (p_credits - v_from_plan),
      total_spent    = w.total_spent   + p_credits,
      total_cost_usd = w.total_cost_usd + coalesce(p_cost_usd, 0),
      updated_at     = now()
    where w.store_id = p_store_id;

    insert into public.wallet_ledger (store_id, delta, bucket, reason, cost_usd, ref)
      values (p_store_id, -p_credits,
              case when v_from_plan >= p_credits then 'plan' else 'mixed' end,
              p_kind, p_cost_usd, p_ref);
  end if;
end;
$$;

-- ── auto-provision a wallet (with the 150-credit trial) on store creation ─────
create or replace function public.wallet_on_store() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallet (store_id, topup_credits, trial_granted)
    values (new.id, 150, true)
    on conflict (store_id) do nothing;
  insert into public.wallet_ledger (store_id, delta, bucket, reason)
    values (new.id, 150, 'topup', 'trial_grant');
  return new;
end;
$$;

drop trigger if exists trg_wallet_on_store on public.stores;
create trigger trg_wallet_on_store after insert on public.stores
  for each row execute function public.wallet_on_store();

-- ── backfill: give every existing store a wallet + one-time trial ─────────────
insert into public.wallet (store_id, topup_credits, trial_granted)
  select id, 150, true from public.stores
  on conflict (store_id) do nothing;

insert into public.wallet_ledger (store_id, delta, bucket, reason)
  select s.id, 150, 'topup', 'trial_grant_backfill'
  from public.stores s
  where not exists (select 1 from public.wallet_ledger l where l.store_id = s.id);
