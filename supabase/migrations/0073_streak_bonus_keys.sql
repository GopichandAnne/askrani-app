-- Owner-configurable "share streak" bonus: reward a regular who earns N times in
-- a month with a one-off bonus. Config lives in agent_config; the bonus is
-- credited idempotently (once per member per month) into a per-store system
-- "streak bonus" campaign whose budget_cap is the owner's monthly ceiling.
--   streak_goal        = N confirmed earns in the month to unlock the bonus (0 = off)
--   streak_bonus_cents = the bonus amount in cents
--   streak_cap_cents   = monthly budget ceiling for streak bonuses (money safety)
alter type public.agent_config_key add value if not exists 'streak_goal';
alter type public.agent_config_key add value if not exists 'streak_bonus_cents';
alter type public.agent_config_key add value if not exists 'streak_cap_cents';
