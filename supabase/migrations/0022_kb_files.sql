-- ═══════════════════════════════════════════════════════════════════════════
-- 0022 — knowledge-base file uploads (Storage bucket + source columns)
--
-- KB documents can now come from uploaded files. The original is kept in a
-- private Storage bucket; text is extracted (Gemini for PDF/images, direct for
-- text/csv/md) and chunked into knowledge_index as usual. source_path lets the
-- panel show/download the original.
--
-- All Storage access is via the service-role admin client from owner-gated
-- server code, so the bucket is private with no object policies (service role
-- bypasses RLS).
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('kb', 'kb', false)
on conflict (id) do nothing;

alter table public.knowledge_index
  add column if not exists source_path text,   -- Storage path of the original file
  add column if not exists source_mime text;   -- original mime type
