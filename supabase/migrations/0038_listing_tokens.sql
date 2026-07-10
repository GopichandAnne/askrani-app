-- Listing-scoped tokens ("smart yard signs"). One store (one agent, one KB, one
-- set of connectors) can mint many QR/link tokens, each optionally pinned to a
-- specific listing. When a visitor launches a listing token, Rani LEADS with that
-- listing but stays fully open — they can still ask about and find other listings.
--
-- Backward-compatible: tokens with these columns null behave exactly as before.

alter table public.store_tokens add column if not exists listing_ref text;      -- MLS# or address (attribution/label)
alter table public.store_tokens add column if not exists listing_context text;  -- blurb injected into the prompt to prime the conversation
alter table public.store_tokens add column if not exists listing_chips text;    -- optional newline-separated starter chips for this listing

-- Surface the launched token's listing to the public chat. Same shape as 0035
-- with listing fields added, and chips prefer the token's listing chips when set.
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
    'listing_ref', t.listing_ref,
    'listing_context', t.listing_context,
    'chips', coalesce(
      t.listing_chips,
      (select c.value from public.agent_config c
        where c.store_id = s.id and c.key = 'suggestion_chips' limit 1)
    )
  )
  from public.stores s
  join public.store_tokens t on t.store_id = s.id
  where s.slug = p_slug and s.active
    and t.token = p_token and t.active
    and (t.expires_at is null or t.expires_at > now())
  limit 1;
$$;

grant execute on function public.validate_store_token(text, text) to anon, authenticated;
