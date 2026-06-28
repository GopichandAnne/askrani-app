-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 — Row-Level Security policies
--
-- Principles:
--   * Every policy targets the `authenticated` role. `anon` gets NOTHING.
--   * Store scoping: id-keyed tables use user_store_ids(); slug-keyed mirror
--     tables use user_store_slugs().
--   * Owner-gated writes use user_is_owner(store_id). Platform admins pass all
--     owner checks (baked into the helper).
--   * thread_messages is APPEND-ONLY: insert allowed, no update/delete policy.
--   * store_secrets and platform_admins have NO policies -> service-role only.
--   * service_role has BYPASSRLS, so the bot/dual-write and server routes are
--     unaffected by any policy here.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── stores ──────────────────────────────────────────────────────────────────
create policy stores_select on public.stores
  for select to authenticated
  using (id in (select public.user_store_ids()));

create policy stores_update_owner on public.stores
  for update to authenticated
  using (public.user_is_owner(id))
  with check (public.user_is_owner(id));

create policy stores_delete_owner on public.stores
  for delete to authenticated
  using (public.user_is_owner(id));

-- New store creation is a platform-admin action.
create policy stores_insert_admin on public.stores
  for insert to authenticated
  with check (public.is_platform_admin());

-- ── store_secrets ───────────────────────────────────────────────────────────
-- NO POLICIES. RLS is enabled; only the service role (BYPASSRLS) can read/write.
-- The anon/authenticated client can NEVER select WhatsApp tokens. (Verified in
-- RLS_TESTS.md / supabase/tests/rls_test.sql.)

-- ── platform_admins ─────────────────────────────────────────────────────────
-- NO POLICIES. Service-role managed only.

-- ── staff ───────────────────────────────────────────────────────────────────
-- Members of a store can see its staff list; owners manage it.
create policy staff_select on public.staff
  for select to authenticated
  using (store_id in (select public.user_store_ids()));

create policy staff_insert_owner on public.staff
  for insert to authenticated
  with check (public.user_is_owner(store_id));

create policy staff_update_owner on public.staff
  for update to authenticated
  using (public.user_is_owner(store_id))
  with check (public.user_is_owner(store_id));

create policy staff_delete_owner on public.staff
  for delete to authenticated
  using (public.user_is_owner(store_id));

-- ── orders ──────────────────────────────────────────────────────────────────
-- Any staff of the store may read and write (status actions). No client delete.
create policy orders_select on public.orders
  for select to authenticated
  using (store_slug in (select public.user_store_slugs()));

create policy orders_insert on public.orders
  for insert to authenticated
  with check (store_slug in (select public.user_store_slugs()));

create policy orders_update on public.orders
  for update to authenticated
  using (store_slug in (select public.user_store_slugs()))
  with check (store_slug in (select public.user_store_slugs()));

-- ── threads ─────────────────────────────────────────────────────────────────
-- Read + routing-state toggle for any staff of the store.
create policy threads_select on public.threads
  for select to authenticated
  using (store_slug in (select public.user_store_slugs()));

create policy threads_insert on public.threads
  for insert to authenticated
  with check (store_slug in (select public.user_store_slugs()));

create policy threads_update on public.threads
  for update to authenticated
  using (store_slug in (select public.user_store_slugs()))
  with check (store_slug in (select public.user_store_slugs()));

-- ── thread_messages (APPEND-ONLY) ───────────────────────────────────────────
create policy thread_messages_select on public.thread_messages
  for select to authenticated
  using (store_slug in (select public.user_store_slugs()));

create policy thread_messages_insert on public.thread_messages
  for insert to authenticated
  with check (store_slug in (select public.user_store_slugs()));
-- Intentionally NO update / delete policy -> append-only audit trail.

-- ── conversations (analytics turn log — client read-only) ───────────────────
create policy conversations_select on public.conversations
  for select to authenticated
  using (store_slug in (select public.user_store_slugs()));
-- Writes happen via service role (bot dual-write / migration). No client writes.

-- ── carts (display mirror — client read-only) ───────────────────────────────
create policy carts_select on public.carts
  for select to authenticated
  using (store_slug in (select public.user_store_slugs()));
-- Mirror is written opportunistically by the service role only.

-- ── tickets (display mirror — client read-only in v1) ───────────────────────
create policy tickets_select on public.tickets
  for select to authenticated
  using (store_slug in (select public.user_store_slugs()));
-- Answer flow goes through a service-role server route (durable trace is the
-- ticket_resolved event in thread_messages).

-- ── saved_qa (any staff of the store may read/write) ────────────────────────
create policy saved_qa_select on public.saved_qa
  for select to authenticated
  using (store_id in (select public.user_store_ids()));

create policy saved_qa_insert on public.saved_qa
  for insert to authenticated
  with check (store_id in (select public.user_store_ids()));

create policy saved_qa_update on public.saved_qa
  for update to authenticated
  using (store_id in (select public.user_store_ids()))
  with check (store_id in (select public.user_store_ids()));

create policy saved_qa_delete on public.saved_qa
  for delete to authenticated
  using (store_id in (select public.user_store_ids()));

-- ── agent_config (OWNERS only for writes; any staff may read) ───────────────
create policy agent_config_select on public.agent_config
  for select to authenticated
  using (store_id in (select public.user_store_ids()));

create policy agent_config_insert_owner on public.agent_config
  for insert to authenticated
  with check (public.user_is_owner(store_id));

create policy agent_config_update_owner on public.agent_config
  for update to authenticated
  using (public.user_is_owner(store_id))
  with check (public.user_is_owner(store_id));

create policy agent_config_delete_owner on public.agent_config
  for delete to authenticated
  using (public.user_is_owner(store_id));

-- ── agent_config_history (read-scoped; appended by service role) ────────────
create policy agent_config_history_select on public.agent_config_history
  for select to authenticated
  using (store_id in (select public.user_store_ids()));
-- History rows are appended by the save server-route (service role). No client writes.
