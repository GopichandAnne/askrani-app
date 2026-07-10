-- Responders can be reached by EMAIL as well as WhatsApp — pick whichever the
-- store's team prefers. A responder now needs a phone OR an email (or both);
-- escalation/order notifications go out on every channel they have.
alter table public.store_responders
  add column if not exists email text;

-- Allow email-only responders (no WhatsApp phone). The unique (store_slug, phone)
-- still holds for phone responders; nulls are distinct so email-only rows are fine.
alter table public.store_responders
  alter column phone drop not null;
