-- ═══════════════════════════════════════════════════════════════════════════
-- 0019 — agent_config keys for the [NOW: …] date/time context
--
--   timezone     — IANA tz (e.g. America/Chicago) used to compute the store's
--                  local date/time and open/closed status.
--   store_hours  — JSON keyed by JS day index (0=Sun … 6=Sat), value ["HH:MM",
--                  "HH:MM"] open/close or null (closed). Used to compute the
--                  authoritative STORE: OPEN/CLOSED flag so the model never has
--                  to do time math itself.
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.agent_config_key add value if not exists 'timezone';
alter type public.agent_config_key add value if not exists 'store_hours';
