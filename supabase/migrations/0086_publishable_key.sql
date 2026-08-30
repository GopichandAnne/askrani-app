-- ═══════════════════════════════════════════════════════════════════════════
-- 0086 — publishable keys (pk_live_…) for the embeddable widget
--
-- The product/SaaS door tells developers to paste ONE value:
--   <script src=".../embed.js" data-key="pk_live_…" async></script>
-- rather than a slug + a separate token. A publishable key is NOT a secret — it
-- rides in client HTML exactly like today's data-token does — so we don't invent
-- a new trust boundary. A pk_live_ key is simply a `store_tokens` row with a
-- recognizable prefix (listing_ref null, active), which means it validates in
-- web-chat and validate_store_token with ZERO changes to those paths.
--
-- The only new piece the keyed embed needs is a way to find the store from the
-- key ALONE (the iframe URL no longer carries the slug). resolve_store_by_key is
-- validate_store_token with the slug dropped from the WHERE clause — same JSON
-- shape (PublicStore), so the embed page and StoreChat consume it unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.resolve_store_by_key(p_token text)
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
  where t.token = p_token and s.active
    and t.active
    and t.listing_ref is null
    and (t.expires_at is null or t.expires_at > now())
  limit 1;
$$;

grant execute on function public.resolve_store_by_key(text) to anon, authenticated;
