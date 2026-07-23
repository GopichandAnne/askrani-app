-- ═══════════════════════════════════════════════════════════════════════════
-- 0064 — Owner controls: "promote this" context + redemption guardrails
--
-- 1. reward_campaigns.promo_context — free text the owner sets ("post about our
--    weekend biryani") so Rani can tell customers WHAT to promote and the review
--    queue can check relevance.
-- 2. stores.redemption_rules jsonb — { min_bill_cents, max_redeem_cents,
--    exclusion_note }. Cost guardrails at the register. confirm_redemption is
--    updated to enforce the numeric ones atomically; the exclusion note is staff
--    guidance (we have no POS line items to enforce it on).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.reward_campaigns add column if not exists promo_context text;
alter table public.stores add column if not exists redemption_rules jsonb not null default '{}'::jsonb;

-- Re-create confirm_redemption with the store's guardrails applied:
--  • max_redeem_cents  — hard cap on credit per redemption (all surfaces).
--  • min_bill_cents    — a counter redemption (panel_code) with an entered bill
--                        below the minimum is refused (the panel also requires
--                        the bill when a minimum is set).
create or replace function public.confirm_redemption(
  p_pass_id   uuid,
  p_surface   text,
  p_staff_id  uuid,
  p_order_ref text,
  p_bill_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass    public.redemption_passes;
  v_rules   jsonb;
  v_min     integer;
  v_max     integer;
  v_target  integer;
  v_balance integer;
  v_redeem  integer;
  v_left    integer;
  v_row     public.reward_ledger;
  v_take    integer;
begin
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

  -- Store guardrails.
  select redemption_rules into v_rules from public.stores where id = v_pass.store_id;
  v_min := coalesce((v_rules->>'min_bill_cents')::int, 0);
  v_max := coalesce((v_rules->>'max_redeem_cents')::int, 0);

  -- Minimum-bill: only a counter redemption with an entered bill is checkable.
  if v_min > 0 and p_surface = 'panel_code' and p_bill_cents is not null and p_bill_cents < v_min then
    return jsonb_build_object('ok', false, 'error', 'below_minimum', 'min_bill_cents', v_min);
  end if;

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
  if v_max > 0 then
    v_redeem := least(v_redeem, v_max);   -- cap credit per visit
  end if;
  if v_redeem <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_balance',
                              'remaining_balance_cents', v_balance);
  end if;

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
