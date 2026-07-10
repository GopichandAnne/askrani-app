-- Graceful "sold" state for listing ("yard sign") QRs. When an agent turns a
-- listing token off (the home sold / went off-market), the QR should NOT dead-end
-- — it still launches, but Rani leads with "that home is no longer available,
-- here are similar listings." Primary web QRs keep their normal on/off behavior.
--
-- A listing token is "retired" when listing_ref is set and active = false.

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
    'listing_retired', (t.listing_ref is not null and not t.active),
    'chips', coalesce(
      -- a retired listing shows the store's general chips, not the sold home's
      case when t.active then t.listing_chips else null end,
      (select c.value from public.agent_config c
        where c.store_id = s.id and c.key = 'suggestion_chips' limit 1)
    )
  )
  from public.stores s
  join public.store_tokens t on t.store_id = s.id
  where s.slug = p_slug and s.active
    and t.token = p_token
    -- listing tokens still launch when retired (to show similar homes); primary
    -- tokens must be active.
    and (t.active or t.listing_ref is not null)
    and (t.expires_at is null or t.expires_at > now())
  limit 1;
$$;

grant execute on function public.validate_store_token(text, text) to anon, authenticated;
