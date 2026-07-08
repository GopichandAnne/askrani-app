-- ═══════════════════════════════════════════════════════════════════════════
-- 0027 — web chat break mode
--
-- web_chat_paused puts the store's web chat into "Rani is taking a break" mode:
-- the /s/<slug> page shows a break overlay and no chat can happen. Exposed to
-- the public via the token RPC so the login-less page can render it.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.stores
  add column if not exists web_chat_paused boolean not null default false;

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
    'whatsapp_active', (s.whatsapp_status = 'active' and s.whatsapp_display_number is not null),
    'session_minutes', coalesce(s.session_minutes, 30),
    'paused', coalesce(s.web_chat_paused, false),
    'chips', (
      select c.value from public.agent_config c
      where c.store_id = s.id and c.key = 'suggestion_chips' limit 1
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
