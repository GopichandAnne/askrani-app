-- ═══════════════════════════════════════════════════════════════════════════
-- 0087 — white-label flag (enum value only)
--
-- Adds the agent_config key. ALTER TYPE … ADD VALUE must land in its own
-- migration, committed before any function references the new value (0088) —
-- Postgres forbids using a freshly-added enum value in the same transaction.
-- ═══════════════════════════════════════════════════════════════════════════
alter type public.agent_config_key add value if not exists 'white_label';
