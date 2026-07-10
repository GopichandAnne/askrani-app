-- Health monitoring — catch a silent dependency failure (like Google retiring a
-- Gemini model) before a customer does. A pg_cron job pings the `health` edge
-- function every 3 minutes; the function checks Gemini + embeddings + the DB,
-- records the result, and alerts (webhook) on a healthy→failing transition.
create table if not exists public.health_checks (
  id         uuid primary key default gen_random_uuid(),
  checked_at timestamptz not null default now(),
  ok         boolean not null,
  detail     jsonb
);
create index if not exists health_checks_recent_idx on public.health_checks (checked_at desc);
alter table public.health_checks enable row level security; -- service-role only

-- Extensions already enabled in 0030 (pg_cron, pg_net); create if missing anyway.
create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'rani-health') then
    perform cron.unschedule('rani-health');
  end if;
end $$;

select cron.schedule(
  'rani-health',
  '*/3 * * * *',
  $cmd$
    select net.http_post(
      url := 'https://ctdczunzetcftcadbrot.supabase.co/functions/v1/health',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $cmd$
);
