-- ═══════════════════════════════════════════════════════════════════════════
-- 0093 — per-store credit-enforcement flag (enum value only)
--
-- Safe rollout: with CREDITS_ENFORCED=true (master on), only stores whose
-- agent_config 'credits_enforced' = 'true' are actually throttled — so you can
-- switch enforcement on for one store (e.g. NetZoom), watch it, then broaden.
-- (CREDITS_ENFORCED=all enforces every store, skipping this flag.)
-- Enum value in its own migration, per the Postgres new-value rule.
-- ═══════════════════════════════════════════════════════════════════════════
alter type public.agent_config_key add value if not exists 'credits_enforced';
