-- SMS OTP phone verification — a fraud guard on reward REDEMPTION. Once SMS is
-- configured (Twilio env), a member must verify a texted code before they can
-- turn credit into a redemption pass. Mirrors the web email-verify shape (0043).

alter table public.store_members
  add column if not exists phone_verified    boolean not null default false,
  add column if not exists phone_verified_at timestamptz;

-- Short-lived OTP codes, one per (web session, store). Service-role only.
create table if not exists public.phone_verification_codes (
  session_id text not null,
  store_id   uuid not null references public.stores(id) on delete cascade,
  phone      text not null,
  code       text not null,
  attempts   int  not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (session_id, store_id)
);
alter table public.phone_verification_codes enable row level security;
