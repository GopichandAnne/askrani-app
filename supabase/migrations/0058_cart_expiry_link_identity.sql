-- ═══════════════════════════════════════════════════════════════════════════
-- 0058 — idle-cart expiry + carrying identity across a browse link
--
-- 1. Carts never expired. A WhatsApp session is the customer's phone number, so
--    it lives forever — which means a half-built cart from three weeks ago is
--    still sitting there when they come back, and "place my order" would happily
--    include it. Sweep carts idle for 7 days. (Web carts leaked too: the session
--    id rotates every session_minutes, orphaning the row for good.)
--
-- 2. member_sessions.cart_session_id — when a verified WhatsApp customer taps a
--    browse link, the web page must not start a NEW cart: it adopts the cart
--    their WhatsApp thread is already using, so adding in the grid and saying
--    "place my order" back in WhatsApp mean the same basket.
--
-- 3. member_sessions.expires_at — the binding used to live forever. It's capped
--    so a shared/borrowed browser can't stay logged in indefinitely.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.member_sessions
  add column if not exists cart_session_id text,
  add column if not exists expires_at timestamptz;

comment on column public.member_sessions.cart_session_id is
  'Cart to operate on instead of session_id — set when a browse link adopts the sender''s WhatsApp cart.';

-- Cheap scan for the sweeper.
create index if not exists carts_updated_idx on public.carts (updated_at);

create or replace function public.sweep_idle_carts(p_days int default 7)
returns int
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.carts
    where updated_at < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.sweep_idle_carts(int) from public;
grant execute on function public.sweep_idle_carts(int) to service_role;

-- Expired identity bindings go too — they're worthless once lapsed.
create or replace function public.sweep_expired_member_sessions()
returns int
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.member_sessions
    where expires_at is not null and expires_at < now()
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.sweep_expired_member_sessions() from public;
grant execute on function public.sweep_expired_member_sessions() to service_role;

-- Nightly at 03:15 UTC. Deliberately not per-minute: nothing here is urgent.
select cron.schedule(
  'rani-sweep-carts',
  '15 3 * * *',
  $cmd$ select public.sweep_idle_carts(7), public.sweep_expired_member_sessions(); $cmd$
);
