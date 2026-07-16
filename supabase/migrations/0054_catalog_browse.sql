-- ═══════════════════════════════════════════════════════════════════════════
-- 0054 — catalogue browsing: price visibility + faceted search
--
-- Two things:
--
-- 1. price_visibility. Until now "only approved accounts see pricing" lived
--    ONLY in the store's prompt, so it bound the LLM and nothing else. The
--    tap-to-order overlay calls web-cart directly and happily returned wholesale
--    prices to anyone holding the link — walking straight around the gate the
--    chat enforces. Gating has to be a setting the SERVER can read, not a
--    sentence the model reads:
--      'public'  (default) → anyone sees prices. Unchanged for every store today.
--      'members'           → only a verified member sees prices; everyone else
--                            gets the catalogue with price stripped server-side.
--
-- 2. browse_products() — one faceted, paginated, gate-aware search over the
--    catalogue, shared by the web grid, the chat's show_products tool and the
--    WhatsApp list. Hybrid (trigram + vector) when an embedding is supplied,
--    plain filter/text otherwise, so it works with or without a query.
--
-- catalog_label is cosmetic: "Menu" is wrong for a distributor ("Catalogue")
-- or a realtor ("Listings").
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.agent_config_key add value if not exists 'price_visibility';
alter type public.agent_config_key add value if not exists 'catalog_label';
