-- ═══════════════════════════════════════════════════════════════════════════
-- 0028 — WhatsApp redirect toggle (phased rollout)
--
-- A store can have a WhatsApp number set (for testing by the owner / beta users)
-- WITHOUT the public QR redirecting to it yet. whatsapp_redirect_enabled is the
-- switch: only when it's on do /s/<slug> scans redirect to WhatsApp. So the
-- printed in-store QR stays on web chat until the owner goes live.
--
-- The web page redirects based on `whatsapp_active` from the RPC, so we redefine
-- it to require BOTH a number AND the toggle — no client change needed.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.stores
  add column if not exists whatsapp_redirect_enabled boolean not null default false;

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
    -- Redirect only when a number is set AND the owner flipped the toggle on.
    'whatsapp_active', (s.whatsapp_display_number is not null and coalesce(s.whatsapp_redirect_enabled, false)),
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
