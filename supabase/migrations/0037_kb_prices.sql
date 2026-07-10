-- Opt-in: in request mode, allow the bot to state prices that are PUBLISHED in
-- the knowledge base (e.g. a property listing price, a fixed service price) —
-- without weakening the default "never quote a price" rule for stores that don't
-- set it. Used by verticals like real estate where the listed price is a public
-- fact, not a live quote.
alter type agent_config_key add value if not exists 'kb_prices_ok';
