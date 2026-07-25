-- 0065 — Dine-in table ordering (restaurant "Rani as your server" surface)
--
-- Orders placed from a table QR need two things the schema didn't have: a way to
-- say the order is eaten in (not pickup/delivery) and the spot the kitchen serves
-- to. Purely additive — existing pickup/delivery orders are untouched.

alter type public.fulfillment_type add value if not exists 'dine_in';

alter table public.orders add column if not exists table_label text;

comment on column public.orders.table_label is
  'Human-readable spot for dine-in orders (e.g. "Table 5", "Bar") from the diner QR surface. Null for pickup/delivery.';
