-- ═══════════════════════════════════════════════════════════════════════════
-- 0061 — schedule the rewards engine's housekeeping jobs (pg_cron)
--
-- Both are pure SQL functions (migration 0060) — no HTTP, no pg_net. Held reward
-- credit becomes spendable only when release_due_holds() runs, so without this
-- the give-and-get loop never completes on its own.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;

revoke all on function public.release_due_holds() from public;
revoke all on function public.expire_due_credits() from public;
grant execute on function public.release_due_holds() to service_role;
grant execute on function public.expire_due_credits() to service_role;

-- Re-scheduling is idempotent: drop the jobs first if they already exist.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'rani-release-holds') then
    perform cron.unschedule('rani-release-holds');
  end if;
  if exists (select 1 from cron.job where jobname = 'rani-expire-credits') then
    perform cron.unschedule('rani-expire-credits');
  end if;
end $$;

-- Release held credit once its hold window passes. Every 15 min, so the
-- "your credit is ready" moment lands within the hour after the hold clears.
select cron.schedule(
  'rani-release-holds',
  '*/15 * * * *',
  $cmd$ select public.release_due_holds(); $cmd$
);

-- Expire released-but-unredeemed credit. Not urgent — nightly at 03:20 UTC.
select cron.schedule(
  'rani-expire-credits',
  '20 3 * * *',
  $cmd$ select public.expire_due_credits(); $cmd$
);
