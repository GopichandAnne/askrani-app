-- ═══════════════════════════════════════════════════════════════════════════
-- 0092 — credit top-up purchases (pay-as-you-go)
--
-- The monetization loop: 150 free credits on signup (0080) → the bot debits per
-- use → a grace buffer past zero → then stop → the owner buys a top-up pack →
-- credits land in wallet.topup_credits → the bot resumes. Same Stripe account /
-- products / prices as Ask Rani Insights; the webhook credits the SHARED Rani
-- wallet the bot draws from (not a separate ledger).
--
-- billing_events = Stripe event idempotency (a webhook may fire more than once).
-- wallet_topup    = credit the wallet + write the ledger ATOMICALLY, and only
--                   once per Stripe event (idempotency is inside the RPC).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.billing_events (
  event_id   text primary key,                 -- Stripe event id (idempotency key)
  store_id   uuid references public.stores(id) on delete set null,
  kind       text,
  credits    int,
  created_at timestamptz not null default now()
);
alter table public.billing_events enable row level security; -- service-role only

create or replace function public.wallet_topup(
  p_store_id uuid,
  p_credits  int,
  p_reason   text,
  p_event_id text,
  p_ref      jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
begin
  -- Idempotency gate: first sighting of this Stripe event inserts a row; a retry
  -- conflicts and credits nothing.
  insert into public.billing_events (event_id, store_id, kind, credits)
    values (p_event_id, p_store_id, 'topup', p_credits)
    on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return false; -- already processed
  end if;

  insert into public.wallet (store_id) values (p_store_id)
    on conflict (store_id) do nothing;
  update public.wallet
     set topup_credits = topup_credits + p_credits, updated_at = now()
   where store_id = p_store_id;
  insert into public.wallet_ledger (store_id, delta, bucket, reason, ref)
    values (p_store_id, p_credits, 'topup', p_reason, p_ref);
  return true;
end
$$;
-- Called by the webhook via the service role; no anon/authenticated grant.
