-- Per-store entitlement: grant access to the embedded Ask Rani Insights product.
-- A platform admin toggles this from /admin/stores; owners of an enabled store
-- see an "Insights" nav item that opens the Insights app inside an iframe (SSO'd
-- via a signed handoff token — see lib/insights/sso.ts + app/api/insights/sso).
-- Default off, so nothing changes for existing stores until explicitly granted.

alter table public.stores
  add column if not exists insights_enabled boolean not null default false;

comment on column public.stores.insights_enabled is
  'Platform-admin grant: when true, this store can open the embedded Ask Rani Insights product.';
