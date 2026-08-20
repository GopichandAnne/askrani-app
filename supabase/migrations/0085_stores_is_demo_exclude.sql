-- ═══════════════════════════════════════════════════════════════════════════
-- is_demo flag + exclude demo/inactive stores from the Insights shared-wallet
-- auto-link. Without this, a real Insights org whose owner email also owns a DEMO
-- store would auto-bill against that demo store's wallet. Demos are flagged here
-- and skipped by store_slug_for_owner_email (the email→store resolver).
--
-- Seeds the known demo (demo-grocery). Flag any others the same way, e.g.:
--   update public.stores set is_demo = true
--   where slug in ('netzoom-demo','apartment-demo','ludicrous-distro', ...);
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.stores add column if not exists is_demo boolean not null default false;

update public.stores set is_demo = true where slug = 'demo-grocery';

create or replace function public.store_slug_for_owner_email(p_email text)
returns text
language sql
security definer
set search_path = public, auth
as $$
  select s.slug
  from auth.users u
  join public.staff st on st.user_id = u.id and st.role = 'owner' and st.status = 'active'
  join public.stores s on s.id = st.store_id
  where u.email is not null
    and lower(u.email) = lower(trim(p_email))
    and s.is_demo = false
    and s.active = true
  order by st.created_at asc
  limit 1
$$;

revoke all on function public.store_slug_for_owner_email(text) from public, anon, authenticated;
grant execute on function public.store_slug_for_owner_email(text) to service_role;

comment on column public.stores.is_demo is
  'Demo/test store — excluded from the Insights shared-wallet auto-link (store_slug_for_owner_email).';
