-- ═══════════════════════════════════════════════════════════════════════════
-- 0018 — agent_config keys for the Agent Setup screen
--
-- The bot's system prompt is assembled from agent_config (Option B: Postgres is
-- the source of truth, no hardcoding). The Agent Setup screen edits these rows.
-- New keys:
--   order_prompt   — the owner's ordering/checkout instructions (shown only when
--                    ordering is enabled).
--   orders_enabled — 'true' | 'false'. When false the bot is info/nav/Q&A only:
--                    the cart/place_order tools and order prompt are omitted.
--   store_layout   — aisle map / navigation reference (used by navigation later).
--
-- ALTER TYPE ADD VALUE only appends labels here (never used in this migration),
-- so it's transaction-safe.
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.agent_config_key add value if not exists 'order_prompt';
alter type public.agent_config_key add value if not exists 'orders_enabled';
alter type public.agent_config_key add value if not exists 'store_layout';
