-- ═══════════════════════════════════════════════════════════════════════════
-- 0017 — atomic order-id sequence (Bot Phase 3c: place_order)
--
-- order_id is <PREFIX>-<YEAR>-<SEQ>. The SEQ must be unique per store per year
-- with no races (two concurrent WhatsApp placements must not collide). A
-- SELECT max()+1 would race; instead an INSERT ... ON CONFLICT DO UPDATE ...
-- RETURNING atomically bumps a per-(store, year) counter under a row lock.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.order_counters (
  store_slug text not null references public.stores(slug) on update cascade,
  year       int  not null,
  seq        int  not null default 0,
  primary key (store_slug, year)
);

alter table public.order_counters enable row level security;
-- service-role only (the bot); no client policy. SECURITY DEFINER fn below.
grant select, insert, update on public.order_counters to service_role;

create or replace function public.next_order_seq(p_store_slug text, p_year int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
begin
  insert into public.order_counters (store_slug, year, seq)
    values (p_store_slug, p_year, 1)
  on conflict (store_slug, year)
    do update set seq = public.order_counters.seq + 1
  returning seq into v_seq;
  return v_seq;
end;
$$;

grant execute on function public.next_order_seq(text, int) to service_role;
