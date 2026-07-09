-- Promotions: a per-store agent_config key holding the owner's promotion
-- instructions (what to promote and when). The bot weaves these in naturally
-- and sparingly; guardrails live in the prompt. Null/absent = no promotions.
alter type agent_config_key add value if not exists 'promotions';
