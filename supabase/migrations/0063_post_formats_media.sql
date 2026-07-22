-- ═══════════════════════════════════════════════════════════════════════════
-- 0063 — Post & Earn refinements: per-format credit + shareable media
--
-- 1. A third pricing model for ugc_post rules: 'format' — a per-format amount
--    map ({reel, post, story, video} -> cents), so a reel can pay more than a
--    post. The reviewer picks the format at approval; computeAmountCents reads
--    format_amounts[format]. (Existing models: flat, tier/by-reach.)
-- 2. share_media on the campaign: owner-uploaded images Rani hands to customers
--    to post (ready-made, tagged content). Optional per campaign.
--
-- Additive only; service-role RLS unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.reward_amount_model add value if not exists 'format';

alter table public.reward_rules
  add column if not exists format_amounts jsonb;   -- {"reel":800,"post":500,"story":300}

alter table public.reward_campaigns
  add column if not exists share_media jsonb not null default '[]'::jsonb;  -- [{url,label}]
