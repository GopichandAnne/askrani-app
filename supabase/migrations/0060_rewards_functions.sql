-- ═══════════════════════════════════════════════════════════════════════════
-- 0060 — Rewards engine: atomic SQL functions
--
-- The money-moving operations MUST be atomic and row-locked so two concurrent
-- checkouts can't redeem the same credit twice. Postgres functions with
-- SELECT ... FOR UPDATE are the only correct place for that — the REST client
-- can't hold a row lock across statements. The TS module (_shared/rewards.ts)
-- calls these via rpc().
--
-- SECURITY DEFINER + search_path='' — service-role callers only (RLS is on and
-- deny-by-default; these run as definer to do the locked work).
-- ═══════════════════════════════════════════════════════════════════════════

-- Spendable balance = released, unexpired credit only. Held/pending is not yet
-- spendable; redeemed/expired/reversed is gone.
create or replace function public.reward_balance(p_store_id uuid, p_member_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_cents), 0)::int
  from public.reward_ledger
  where store_id = p_store_id
    and member_id = p_member_id
    and status = 'released'
    and (expires_at is null or expires_at > now());
$$;

-- Confirm a redemption atomically. Locks the pass + the member's released ledger
-- rows, redeems the smaller of {pass amount, actual bill, current balance},
-- draws it down FIFO (soonest-to-expire first), leaves any remainder on the
-- ledger, and marks the pass confirmed. Never returns cash; never double-spends.
--
-- Returns jsonb: {ok, error?, redeemed_cents, remaining_balance_cents}.
create or replace function public.confirm_redemption(
  p_pass_id   uuid,
  p_surface   text,
  p_staff_id  uuid,
  p_order_ref text,
  p_bill_cents integer   -- null = redeem the pass's full amount (no partial)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass    public.redemption_passes;
  v_target  integer;
  v_balance integer;
  v_redeem  integer;
  v_left    integer;
  v_row     public.reward_ledger;
  v_take    integer;
begin
  -- Lock the pass. Reject if missing / already used / expired.
  select * into v_pass from public.redemption_passes
    where id = p_pass_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'pass_not_found');
  end if;
  if v_pass.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'pass_' || v_pass.status);
  end if;
  if v_pass.expires_at <= now() then
    update public.redemption_passes set status = 'expired' where id = v_pass.id;
    return jsonb_build_object('ok', false, 'error', 'pass_expired');
  end if;

  -- Lock the member's spendable rows so the balance can't move under us.
  perform 1 from public.reward_ledger
    where store_id = v_pass.store_id and member_id = v_pass.member_id
      and status = 'released' and (expires_at is null or expires_at > now())
    for update;

  select coalesce(sum(amount_cents), 0)::int into v_balance
    from public.reward_ledger
    where store_id = v_pass.store_id and member_id = v_pass.member_id
      and status = 'released' and (expires_at is null or expires_at > now());

  v_target := coalesce(p_bill_cents, v_pass.amount_cents);
  v_redeem := least(v_pass.amount_cents, v_target, v_balance);
  if v_redeem <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_balance',
                              'remaining_balance_cents', v_balance);
  end if;

  -- Draw down FIFO: soonest-to-expire first, then oldest.
  v_left := v_redeem;
  for v_row in
    select * from public.reward_ledger
      where store_id = v_pass.store_id and member_id = v_pass.member_id
        and status = 'released' and (expires_at is null or expires_at > now())
      order by expires_at asc nulls last, created_at asc
      for update
  loop
    exit when v_left <= 0;
    v_take := least(v_row.amount_cents, v_left);
    if v_take >= v_row.amount_cents then
      update public.reward_ledger
        set status = 'redeemed', amount_cents = 0, updated_at = now()
        where id = v_row.id;
    else
      update public.reward_ledger
        set amount_cents = amount_cents - v_take, updated_at = now()
        where id = v_row.id;
    end if;
    insert into public.reward_redemptions(ledger_id, pass_id, order_ref, amount_cents, remainder_cents)
      values (v_row.id, v_pass.id, p_order_ref, v_take, greatest(v_row.amount_cents - v_take, 0));
    v_left := v_left - v_take;
  end loop;

  update public.redemption_passes
    set status = 'confirmed', surface = p_surface::public.redemption_surface,
        staff_id = p_staff_id, confirmed_at = now()
    where id = v_pass.id;

  return jsonb_build_object(
    'ok', true,
    'redeemed_cents', v_redeem,
    'remaining_balance_cents', v_balance - v_redeem
  );
end;
$$;

-- Cron: move held credit to released once the hold window passes, stamping the
-- expiry clock from the campaign. (Fraud-held rows are kept as 'pending', so
-- they are not picked up here.)
create or replace function public.release_due_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  with upd as (
    update public.reward_ledger l
      set status = 'released',
          expires_at = now() + make_interval(days => c.credit_expiry_days),
          updated_at = now()
      from public.reward_campaigns c
      where l.campaign_id = c.id
        and l.status = 'held'
        and l.hold_until <= now()
      returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end;
$$;

-- Cron: expire released credit that was never redeemed.
create or replace function public.expire_due_credits()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  with upd as (
    update public.reward_ledger
      set status = 'expired', updated_at = now()
      where status = 'released'
        and expires_at is not null
        and expires_at <= now()
      returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end;
$$;
