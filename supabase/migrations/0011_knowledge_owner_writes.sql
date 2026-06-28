-- ═══════════════════════════════════════════════════════════════════════════
-- 0011 — saved_qa edits are owner-only (staff keep read access)
--
-- Phase 1 RLS allowed any staff to write saved_qa. The Knowledge module is an
-- owner-managed list (UI scope: "owner-gated edits"), so tighten INSERT/UPDATE/
-- DELETE to owners (platform admins included). SELECT stays any-staff.
--
-- Whole-row owner gating -> pure RLS (no column-level trigger needed). RLS is
-- enforced on every path, so the raw-PostgREST path is closed too.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists saved_qa_insert on public.saved_qa;
create policy saved_qa_insert on public.saved_qa
  for insert to authenticated
  with check (public.user_is_owner(store_id));

drop policy if exists saved_qa_update on public.saved_qa;
create policy saved_qa_update on public.saved_qa
  for update to authenticated
  using (public.user_is_owner(store_id))
  with check (public.user_is_owner(store_id));

drop policy if exists saved_qa_delete on public.saved_qa;
create policy saved_qa_delete on public.saved_qa
  for delete to authenticated
  using (public.user_is_owner(store_id));

-- saved_qa_select (any staff of the store) is unchanged.
