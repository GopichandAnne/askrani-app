-- ═══════════════════════════════════════════════════════════════════════════
-- 0102 — get_chat_history: let the embedded chat re-load a session's recent
-- messages on open, so the conversation persists across page reloads / logins
-- (today the session id is kept in localStorage but the transcript starts empty).
--
-- The token is the PUBLIC publishable key (it already rides in the embed). The
-- session id is an unguessable bearer (`web_<uuid>`) held only in the visitor's
-- own browser — so a visitor can only read their OWN session's messages. Returns
-- just the visible message bubbles (kind = 'message'), both directions, oldest→
-- newest. SECURITY DEFINER + anon grant (same trust model as the chat itself).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.get_chat_history(
  p_token text,
  p_session_id text,
  p_limit int default 50
)
returns json
language sql
security definer
stable
set search_path = public
as $$
  with s as (
    select st.slug
    from public.store_tokens t
    join public.stores st on st.id = t.store_id
    where t.token = p_token and t.active
    limit 1
  )
  select coalesce(json_agg(row_to_json(m) order by m.created_at asc), '[]'::json)
  from (
    select tm.message_id, tm.direction, tm.text, tm.media_url, tm.created_at
    from public.thread_messages tm, s
    where tm.thread_id = 'thr_' || p_session_id || '_' || s.slug
      and tm.kind = 'message'
    order by tm.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) m;
$$;

grant execute on function public.get_chat_history(text, text, int) to anon, authenticated;
