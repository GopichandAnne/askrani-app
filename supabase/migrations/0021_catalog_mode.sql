-- ═══════════════════════════════════════════════════════════════════════════
-- 0021 — catalog_enabled agent_config key (catalogue vs request pricing mode)
--
--   catalog_enabled = 'true'  → structured catalogue is set: the bot may look up
--                               products and SHOW prices (priced ordering).
--   catalog_enabled = 'false' → request mode: the catalogue lives in the KB, the
--                               bot NEVER quotes a price (even if the KB has one),
--                               and every order line is a request item the store
--                               team / POS prices at confirmation.
--
-- Default (unset) is treated as request mode by the bot — generic + safe.
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.agent_config_key add value if not exists 'catalog_enabled';
