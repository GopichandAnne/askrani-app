-- ═══════════════════════════════════════════════════════════════════════════
-- 0057 — expose catalog_label + price_visibility to the web chat
--
-- The launcher button is hardcoded "View menu", which is wrong for anyone who
-- isn't a restaurant (a distributor browses a Catalogue, a realtor Listings).
-- The owner already sets catalog_label; the chat has to be able to read it
-- BEFORE opening the overlay, so it belongs in the token payload.
--
-- price_visibility rides along so the chat can tell a guest that pricing needs a
-- verified account without first calling the catalogue. It is a display hint
-- only — the price gate itself is enforced server-side in web-cart/browse; a
-- client must never be trusted with it.
--
-- Based verbatim on the 0051 definition + the two new fields.
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
    ),
    'catalog_label', coalesce((
      select nullif(btrim(c.value), '') from public.agent_config c
      where c.store_id = s.id and c.key = 'catalog_label' limit 1
    ), 'Menu'),
    'prices_require_member', coalesce((
      select lower(btrim(c.value)) = 'members' from public.agent_config c
      where c.store_id = s.id and c.key = 'price_visibility' limit 1
    ), false)
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
