-- ═══════════════════════════════════════════════════════════════════════════
-- 0049 — configurable document upload per request type
--
-- A request type can declare that it accepts a file upload, which extensions are
-- allowed (the owner's allowlist), and which connector parses the file into
-- fields. Purely additive config — nothing here is use-case-specific, and a
-- store with no upload-accepting types behaves exactly as before.
--   accepts_upload : the chat offers a file picker when any enabled type has this
--   upload_types   : allowed extensions, e.g. {pdf,docx,png,jpg}
--   parse_with     : connector (store_integrations.name) that turns the file into
--                    fields, e.g. 'parse_resume'
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.request_types
  add column if not exists accepts_upload boolean not null default false,
  add column if not exists upload_types   text[]  not null default '{}',
  add column if not exists parse_with     text;
