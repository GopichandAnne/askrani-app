-- Silence check-back (proactive nudge) — Bot Phase 5.
-- After each bot reply we schedule one pending_followup; a pg_cron job pings the
-- `followup` edge function every minute, which fires at most one gentle
-- check-back per row when a customer goes quiet, then consumes the row.

-- Per-store settings (opt-out; defaults handled in code: ON, 5 minutes).
alter type agent_config_key add value if not exists 'followup_enabled';
alter type agent_config_key add value if not exists 'followup_minutes';

-- One pending nudge per session (unique) — replaced on each reply, deleted on
-- the customer's next message.
create table if not exists public.pending_followups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  store_slug text not null,
  session_id text not null,
  channel text not null check (channel in ('whatsapp', 'web')),
  thread_id text not null,
  customer_ref text not null,
  phone_number_id text,
  due_at timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (store_id, session_id)
);

create index if not exists pending_followups_due_idx
  on public.pending_followups (status, due_at);

-- Service-role only (edge functions). Enable RLS with no policies so anon /
-- authenticated clients get nothing; the service role bypasses RLS.
alter table public.pending_followups enable row level security;

-- Scheduler: pg_cron ticks once a minute and pings the followup function, which
-- runs with verify_jwt=false (idempotent — it only processes already-due rows).
create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'rani-followups') then
    perform cron.unschedule('rani-followups');
  end if;
end $$;

select cron.schedule(
  'rani-followups',
  '* * * * *',
  $cmd$
    select net.http_post(
      url := 'https://ctdczunzetcftcadbrot.supabase.co/functions/v1/followup',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $cmd$
);
