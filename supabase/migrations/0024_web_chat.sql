-- ═══════════════════════════════════════════════════════════════════════════
-- 0024 — public web chat support
--
-- The public web chat (askrani.ai/s/<slug>) needs a little store info without a
-- login. stores/agent_config are RLS-locked, so we expose ONLY safe public
-- fields through a SECURITY DEFINER RPC granted to anon. The actual chat runs
-- through the web-chat Edge Function (service role), same core as WhatsApp.
--
-- whatsapp_display_number = the store's public E.164 number for a wa.me deep
-- link (distinct from whatsapp_phone_number_id, which is Meta's internal id).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.stores
  add column if not exists whatsapp_display_number text;

create or replace function public.get_public_store(p_slug text)
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
    'whatsapp_active', (s.whatsapp_status = 'active' and s.whatsapp_display_number is not null),
    'chips', (
      select c.value from public.agent_config c
      where c.store_id = s.id and c.key = 'suggestion_chips' limit 1
    )
  )
  from public.stores s
  where s.slug = p_slug and s.active
  limit 1;
$$;

grant execute on function public.get_public_store(text) to anon, authenticated;
