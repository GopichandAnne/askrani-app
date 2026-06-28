-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 — RLS helper functions
--
-- These are SECURITY DEFINER so they bypass RLS *inside the function body*.
-- That is essential: staff/stores policies call these helpers, and the helpers
-- query staff/stores. If they ran as the caller (SECURITY INVOKER) the policy
-- check would re-trigger the policy -> infinite recursion. Definer breaks it.
--
-- `set search_path = ''` forces fully-qualified names (anti-injection hardening).
-- All are STABLE (read-only, safe to cache within a statement).
-- ═══════════════════════════════════════════════════════════════════════════

-- Is the current user a platform admin (legacy store_slug='*')?
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

-- Store IDs the current user may access (all stores if platform admin).
create or replace function public.user_store_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.stores s
  where public.is_platform_admin()
  union
  select st.store_id
  from public.staff st
  where st.user_id = auth.uid()
    and st.status = 'active';
$$;

-- Store SLUGS the current user may access (for slug-keyed mirror tables).
create or replace function public.user_store_slugs()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select s.slug
  from public.stores s
  where s.id in (select public.user_store_ids());
$$;

-- Is the current user an OWNER of the given store (platform admin -> always)?
create or replace function public.user_is_owner(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
      or exists (
        select 1
        from public.staff st
        where st.user_id = auth.uid()
          and st.store_id = p_store_id
          and st.role = 'owner'
          and st.status = 'active'
      );
$$;

-- The querying role must be able to EXECUTE the helpers used in its policies.
grant execute on function public.is_platform_admin()      to authenticated;
grant execute on function public.user_store_ids()         to authenticated;
grant execute on function public.user_store_slugs()       to authenticated;
grant execute on function public.user_is_owner(uuid)      to authenticated;
