-- ─────────────────────────────────────────────────────────────────────────────
-- reset-wallets.sql — run ONCE, right BEFORE setting CREDITS_ENFORCED=true.
--
-- During the record-only phase the bot debited wallets without ever blocking, so
-- some balances have drifted low or negative. Flipping enforcement would then
-- instantly cut those stores off. This gives every active store a clean starting
-- balance so no one is blocked on day one.
--
-- SAFE: it only LIFTS stores below the target up to it — it never reduces a store
-- that's already above (e.g. one that purchased a big pack keeps its balance).
-- Idempotent-ish: re-running only tops up anyone who has since fallen below.
--
-- Not a migration (lives in supabase/scripts/, not supabase/migrations/) because
-- it's a timed data operation, not schema. Run it in the Supabase SQL editor, or:
--   psql "$DATABASE_URL" -f supabase/scripts/reset-wallets.sql
--
-- Adjust v_target to the free allotment you want everyone to start enforcement
-- with (credits ≈ $0.02 of AI cost each; 500 ≈ a healthy buffer).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_target int := 500;   -- clean starting balance per store
  r        record;
  v_bal    int;
  v_grant  int;
begin
  -- Ensure every active store has a wallet row (belt-and-suspenders; the 0080
  -- trigger already creates one on store creation).
  insert into public.wallet (store_id)
  select s.id
  from public.stores s
  where s.active
    and not exists (select 1 from public.wallet w where w.store_id = s.id);

  -- Lift below-target stores up to the target; leave everyone else untouched.
  for r in
    select w.store_id, w.plan_credits, w.topup_credits
    from public.wallet w
    join public.stores s on s.id = w.store_id and s.active
  loop
    v_bal := coalesce(r.plan_credits, 0) + coalesce(r.topup_credits, 0);
    if v_bal < v_target then
      v_grant := v_target - v_bal;
      update public.wallet
         set topup_credits = topup_credits + v_grant, updated_at = now()
       where store_id = r.store_id;
      insert into public.wallet_ledger (store_id, delta, bucket, reason, ref)
      values (r.store_id, v_grant, 'topup', 'balance_reset',
              jsonb_build_object('reset_to', v_target, 'prev_balance', v_bal));
    end if;
  end loop;

  raise notice 'reset-wallets: every active store now has at least % credits', v_target;
end $$;
