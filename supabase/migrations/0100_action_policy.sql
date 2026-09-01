-- Preventive governance for agentic tools — the owner-side control that makes
-- "act as the signed-in customer" safe to sell upmarket.
-- action_policy governs whether a WRITE (side_effect) tool may execute:
--   'auto' — Rani may perform it (after the customer confirms). Default; unchanged.
--   'hold' — Rani may NOT perform it; it's blocked and flagged for a person.
-- Reads (non-side_effect tools) are unaffected. Enforced in the executors, not by
-- the model — the model can never override a 'hold'.
alter table public.http_tool add column if not exists action_policy text not null default 'auto';
alter table public.mcp_tool  add column if not exists action_policy text not null default 'auto';
