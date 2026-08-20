-- ═══════════════════════════════════════════════════════════════════════════
-- store_slug_for_owner_email — the email→store join for the Insights shared-wallet
-- auto-link ("one account, one wallet"). Given a VERIFIED email, returns the slug
-- of the store that email OWNS (staff.role='owner', active), or null.
--
-- SECURITY DEFINER so it can read auth.users; locked to service-role callers only
-- (the `wallet` edge function, secret-authed) — never anon/authenticated, so it is
-- not exposed to end users via PostgREST. Matches the OWNER's verified auth email
-- on both sides, so a business that signs into Rani + Insights with the same
-- account is recognized as one. Oldest owned store wins if there are several.
-- ═══════════════════════════════════════════════════════════════════════════
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
  order by st.created_at asc
  limit 1
$$;

revoke all on function public.store_slug_for_owner_email(text) from public, anon, authenticated;
grant execute on function public.store_slug_for_owner_email(text) to service_role;

comment on function public.store_slug_for_owner_email(text) is
  'Insights shared-wallet auto-link: verified owner email -> owned store slug. Service-role only (wallet edge fn).';
