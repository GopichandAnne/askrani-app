-- Optional self-serve web email verification (OTP). Off by default; the owner
-- turns it on. When on, a visitor on the public web chat can verify their email
-- with a one-time code and be matched to a member — no embedded portal needed.

alter table public.stores
  add column if not exists web_email_verification boolean not null default false;

create table if not exists public.web_verification_codes (
  session_id text not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null,
  code text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (session_id, store_id)
);
alter table public.web_verification_codes enable row level security; -- service-role only

-- Surface the flag to the public chat. Same as 0039 with email_verification added.
create or replace function public.validate_store_token(p_slug text, p_token text)
returns json
language sql
security definer
stable
set search_path = public
as $$
  select json_build_object(
    'slug', s.slug,
    'display_name', coalesce(s.store_display_name, s.slug),
    'business_type', s.business_type,
    'whatsapp_number', s.whatsapp_display_number,
    'whatsapp_active', (s.whatsapp_display_number is not null and coalesce(s.whatsapp_redirect_enabled, false)),
    'session_minutes', coalesce(s.session_minutes, 30),
    'paused', coalesce(s.web_chat_paused, false),
    'logo_url', s.logo_url,
    'email_verification', coalesce(s.web_email_verification, false),
    'listing_ref', t.listing_ref,
    'listing_context', t.listing_context,
    'listing_retired', (t.listing_ref is not null and not t.active),
    'chips', coalesce(
      case when t.active then t.listing_chips else null end,
      (select c.value from public.agent_config c
        where c.store_id = s.id and c.key = 'suggestion_chips' limit 1)
    )
  )
  from public.stores s
  join public.store_tokens t on t.store_id = s.id
  where s.slug = p_slug and s.active
    and t.token = p_token
    and (t.active or t.listing_ref is not null)
    and (t.expires_at is null or t.expires_at > now())
  limit 1;
$$;

grant execute on function public.validate_store_token(text, text) to anon, authenticated;
