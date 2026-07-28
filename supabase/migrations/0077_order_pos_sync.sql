-- POS dispatch tracking on orders. When an owner approves an order and it's
-- pushed to a connected POS (Square first), we record the external order id for
-- idempotency (never double-send), audit, and a per-order "synced" indicator in
-- the panel. Generic across providers so Toast/Clover can reuse it later.
alter table public.orders
  add column if not exists pos_provider  text,          -- e.g. 'square'
  add column if not exists pos_order_id  text,          -- external order/ticket id
  add column if not exists pos_synced_at timestamptz,   -- when the push succeeded
  add column if not exists pos_error     text;          -- last push failure (for retry UI)

-- One external order per (provider, external id) — a belt-and-suspenders guard
-- against a duplicate push creating two tickets for the same order.
create unique index if not exists uq_orders_pos_ref
  on public.orders (pos_provider, pos_order_id)
  where pos_order_id is not null;
