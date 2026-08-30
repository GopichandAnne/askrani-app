-- ═══════════════════════════════════════════════════════════════════════════
-- 0094 — "is the widget installed?" signal
--
-- The embedded chat page stamps this each time it loads, so the console can tell
-- the owner their embed is actually live on their site (and the setup checklist's
-- "Install" step can complete honestly instead of guessing from a minted key).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.stores add column if not exists last_embed_at timestamptz;

-- Stamp last_embed_at for the store that owns this active token. Called anon from
-- the embed page (best-effort); resolves the store via the token so no store id is
-- exposed to the client.
create or replace function public.mark_embed_seen(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.stores s
     set last_embed_at = now()
    from public.store_tokens t
   where t.store_id = s.id
     and t.token = p_token
     and t.active;
$$;

grant execute on function public.mark_embed_seen(text) to anon, authenticated;
