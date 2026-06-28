-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 — Realtime for the Orders screen (the signature live feed)
--
-- Adds `orders` to the supabase_realtime publication so the admin panel receives
-- INSERT/UPDATE/DELETE. REPLICA IDENTITY FULL makes UPDATE/DELETE payloads carry
-- the full row (needed to render changed rows and match the active-store filter
-- on the client). Realtime still honors RLS: a subscriber only receives changes
-- for rows their SELECT policy allows (i.e. their own stores).
--
-- Idempotent: safe to re-run / re-apply.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.orders replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end
$$;
