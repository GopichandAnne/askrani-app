-- Store logo shown in the chat interface (header + welcome) instead of the
-- default Rani avatar. Uploaded to a PUBLIC storage bucket (the chat is public,
-- so a public URL avoids signed-URL expiry). Null = fall back to the default.

alter table public.stores add column if not exists logo_url text;

-- Public bucket for store branding assets (logos).
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

-- Uploads happen via the service-role admin client from owner-gated server code
-- (bypasses RLS), and reads are public (bucket is public) — no object policies
-- needed. Cap object size at the bucket level for safety.
update storage.buckets set file_size_limit = 2097152 where id = 'branding'; -- 2 MB

-- Surface logo_url to the public chat (validate_store_token). Same definition as
-- 0028 with one field added.
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
