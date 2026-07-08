-- ═══════════════════════════════════════════════════════════════════════════
-- 0026 — image messages
--
-- thread_messages.media_url holds an image URL for a message. On web, send_image
-- writes an outbound row with media_url (a signed Storage URL) and Realtime
-- pushes it into the visitor's browser, which renders it inline.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.thread_messages
  add column if not exists media_url text;
