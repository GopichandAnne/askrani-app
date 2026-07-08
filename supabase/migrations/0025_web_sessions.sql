-- ═══════════════════════════════════════════════════════════════════════════
-- 0025 — web chat: store tokens, sessions, and Realtime hand-off
--
-- • store_tokens: each store's QR carries a token. A visitor URL
--   (askrani.ai/s/<slug>?t=<token>) is valid only while the token is active and
--   unexpired — else the page shows a "rescan" screen.
-- • stores.session_minutes: how long a visitor session lasts (default 30).
-- • Realtime on thread_messages + a narrow anon SELECT policy for web threads,
--   so a staff answer (written to thr_web_<uuid>_<slug>) is pushed live into the
--   visitor's browser. The web session id is an unguessable uuid.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.stores
  add column if not exists session_minutes integer not null default 30;

create table if not exists public.store_tokens (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  token       text not null unique,
  label       text,
  active      boolean not null default true,
  expires_at  timestamptz,               -- null = never expires
  created_at  timestamptz not null default now()
);
create index if not exists idx_store_tokens_store on public.store_tokens(store_id);
alter table public.store_tokens enable row level security; -- service-role + RPC only; no client policy

-- Validate a visitor link and return safe public store info (or null).
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

-- ── Realtime hand-off: push staff answers into the web chat ──────────────────
alter publication supabase_realtime add table public.thread_messages;

-- Anon may read messages on WEB threads only (id = thr_web_<uuid>_<slug>). The
-- uuid is unguessable; this is what lets Realtime deliver staff replies to the
-- visitor's browser. WhatsApp threads (thr_<phone>_<slug>) stay private.
create policy "web_thread_read_anon" on public.thread_messages
  for select to anon
  using (thread_id like 'thr\_web\_%');
