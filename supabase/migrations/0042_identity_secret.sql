-- Per-store signing secret for embedded SSO. When the widget is embedded on the
-- store's own website, the store's backend signs a short-lived identity token
-- (the logged-in user's email/phone) with this secret; the web-chat function
-- verifies it — so the store's existing website login drives the member context
-- with no separate login managed by us. Null = SSO not set up.

alter table public.stores add column if not exists identity_secret text;
