-- ═══════════════════════════════════════════════════════════════════════════
-- RLS automated test (pgTAP).  Run with:  supabase test db
--
-- Proves the core RLS guarantee: a staff member of store A cannot read store B's
-- orders / threads / agent_config, no client can read store_secrets, and writes
-- to owner-gated tables are blocked for non-owners.
--
-- Fixtures (created here; rolled back at COMMIT/ROLLBACK):
--   userA  (11111111…) = OWNER of store A  (man-pasand-lakeline)
--   userB  (22222222…) = OWNER of store B  (foodistan-cedar-park)
--   userC  (33333333…) = STAFF (non-owner) of store A
-- Stores + default agent_config are already present from migration 0005.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
create extension if not exists pgtap;

select plan(12);

-- ─────────────────────────── SETUP (as superuser — bypasses RLS) ───────────
insert into auth.users (instance_id, id, aud, role, email, created_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ownerA@test.local', now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'ownerB@test.local', now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'staffC@test.local', now());

insert into public.staff (user_id, store_id, role, name, status)
select '11111111-1111-1111-1111-111111111111', id, 'owner', 'Owner A', 'active'
from public.stores where slug = 'man-pasand-lakeline';

insert into public.staff (user_id, store_id, role, name, status)
select '22222222-2222-2222-2222-222222222222', id, 'owner', 'Owner B', 'active'
from public.stores where slug = 'foodistan-cedar-park';

insert into public.staff (user_id, store_id, role, name, status)
select '33333333-3333-3333-3333-333333333333', id, 'staff', 'Staff C', 'active'
from public.stores where slug = 'man-pasand-lakeline';

-- one secret, one order, one thread per store
insert into public.store_secrets (store_id, whatsapp_access_token)
select id, 'SECRET-A' from public.stores where slug = 'man-pasand-lakeline';
insert into public.store_secrets (store_id, whatsapp_access_token)
select id, 'SECRET-B' from public.stores where slug = 'foodistan-cedar-park';

insert into public.orders (order_id, store_slug, status) values
  ('MP-2026-0001', 'man-pasand-lakeline', 'placed'),
  ('FD-2026-0001', 'foodistan-cedar-park', 'placed');

insert into public.threads (thread_id, store_slug) values
  ('thr_a', 'man-pasand-lakeline'),
  ('thr_b', 'foodistan-cedar-park');

-- ─────────────────────────── userA (owner of store A) ──────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.orders),
  1,
  'userA sees exactly one order (own store only)');

select is(
  (select count(*)::int from public.orders where store_slug = 'foodistan-cedar-park'),
  0,
  'userA CANNOT read store B orders');

select throws_ok(
  $$ select 1 from public.store_secrets $$,
  '42501',
  null,
  'userA CANNOT read store_secrets (table privilege revoked)');

select is(
  (select count(*)::int from public.threads where store_slug = 'foodistan-cedar-park'),
  0,
  'userA CANNOT read store B threads');

select is(
  (select count(*)::int
   from public.agent_config ac
   join public.stores s on s.id = ac.store_id
   where s.slug = 'foodistan-cedar-park'),
  0,
  'userA CANNOT read store B agent_config');

-- owner update runs as a top-level statement; then assert it took effect
update public.agent_config set value = '0.0900' where key = 'tax_rate';
select is(
  (select ac.value
   from public.agent_config ac
   join public.stores s on s.id = ac.store_id
   where s.slug = 'man-pasand-lakeline' and ac.key = 'tax_rate'),
  '0.0900',
  'userA (owner) CAN update own store agent_config tax_rate');

reset role;

-- ─────────────────────────── userC (non-owner staff of store A) ────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

select isnt(
  (select count(*)::int from public.agent_config),
  0,
  'staff C CAN read store A agent_config');

-- non-owner update runs but RLS USING filters it to 0 rows (no error);
-- assert the owner-set value (0.0900) is unchanged
update public.agent_config set value = '0.0999' where key = 'tax_rate';
select is(
  (select ac.value
   from public.agent_config ac
   join public.stores s on s.id = ac.store_id
   where s.slug = 'man-pasand-lakeline' and ac.key = 'tax_rate'),
  '0.0900',
  'staff C (non-owner) CANNOT update agent_config (value unchanged)');

select throws_ok(
  $$ insert into public.agent_config (store_id, key, value)
     select id, 'personality', 'x' from public.stores where slug = 'man-pasand-lakeline' $$,
  '42501',
  null,
  'staff C (non-owner) CANNOT insert agent_config (RLS violation)');

reset role;

-- ─────────────────────────── userB (owner of store B) ──────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.orders where store_slug = 'man-pasand-lakeline'),
  0,
  'userB CANNOT read store A orders');

select throws_ok(
  $$ select 1 from public.store_secrets $$,
  '42501',
  null,
  'userB CANNOT read store_secrets (table privilege revoked)');

reset role;

-- ─────────────────────────── anon (no session) ─────────────────────────────
set local role anon;

select is(
  (select count(*)::int from public.orders),
  0,
  'anon (no session) sees zero orders');

reset role;

select * from finish();
rollback;
