-- ═══════════════════════════════════════════════════════════════════════════
-- 0020 — store_responders (staff/owner WhatsApp numbers for escalations)
--
-- Instead of a WhatsApp group (which the Cloud API cannot join), Rani DMs each
-- responder 1:1. When a responder replies to Rani's number, the webhook relays
-- their answer to the customer. Responders need NOT have panel logins — this is
-- a separate registry keyed by phone.
--
--   notify_escalations — DM this person the customer's escalated questions.
--   notify_orders      — DM this person when a customer places an order.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.store_responders (
  id                  uuid primary key default gen_random_uuid(),
  store_slug          text not null references public.stores(slug) on update cascade,
  phone               text not null,               -- E.164 WITHOUT '+' (matches wa 'from')
  name                text,
  role                public.staff_role not null default 'staff',
  notify_escalations  boolean not null default true,
  notify_orders       boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (store_slug, phone)
);
create index idx_store_responders_store on public.store_responders(store_slug) where active;

create trigger trg_store_responders_updated_at before update on public.store_responders
  for each row execute function public.set_updated_at();

alter table public.store_responders enable row level security;

-- Members read; owners manage. The bot reads via service_role (BYPASSRLS).
create policy store_responders_select on public.store_responders
  for select to authenticated
  using (store_slug in (select public.user_store_slugs()));

create policy store_responders_write on public.store_responders
  for all to authenticated
  using (exists (select 1 from public.stores s where s.slug = store_slug and public.user_is_owner(s.id)))
  with check (exists (select 1 from public.stores s where s.slug = store_slug and public.user_is_owner(s.id)));

grant select, insert, update, delete on public.store_responders to authenticated;
grant select, insert, update, delete on public.store_responders to service_role;
