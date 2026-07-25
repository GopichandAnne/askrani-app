-- 0070 — Order payment state (diner "Pay now" via the store's own Stripe).
--
-- We never hold funds or card data: the guest pays on Stripe's hosted page against
-- the STORE's Stripe account; a signed Stripe webhook flips the order to paid. The
-- POS then sees a paid order (payment recorded) through the store's usual dispatch.
--
-- 'unpaid' (default) = pay at the counter / not yet paid; 'paid' = Stripe confirmed;
-- 'refunded' = reversed. Every existing order is 'unpaid' → no behaviour change.

alter table public.orders add column if not exists payment_status text not null default 'unpaid';
alter table public.orders add column if not exists payment_ref text;   -- Stripe payment_intent / session id
alter table public.orders add column if not exists paid_at timestamptz;

comment on column public.orders.payment_status is 'unpaid | paid | refunded. Set to paid only by the verified Stripe webhook.';
