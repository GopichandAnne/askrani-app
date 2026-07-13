-- ═══════════════════════════════════════════════════════════════════════════
-- 0051 — expose catalog_enabled to the web chat (menu overlay gate)
--
-- The tap-to-order menu overlay shows only for catalogue stores. Add a
-- `catalog_enabled` boolean to validate_store_token's payload so the chat knows
-- whether to offer the "Menu" button. Based verbatim on the 0050 definition + the
-- one new field.
-- ═══════════════════════════════════════════════════════════════════════════
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
    ),
    'upload_types', coalesce((
      select array_agg(distinct u)
      from public.request_types rt, unnest(rt.upload_types) as u
      where rt.store_id = s.id and rt.enabled and rt.accepts_upload
    ), '{}'),
    'catalog_enabled', (
      select lower(coalesce(c.value, 'false')) = 'true' from public.agent_config c
      where c.store_id = s.id and c.key = 'catalog_enabled' limit 1
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
