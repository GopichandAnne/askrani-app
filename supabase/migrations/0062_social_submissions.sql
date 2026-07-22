-- ═══════════════════════════════════════════════════════════════════════════
-- 0062 — Co-marketing Increment 2: social post-for-credit submissions
--
-- The customer posts about the store on IG/YouTube/FB and pastes the URL; a
-- human reviews it and, on approval, credit accrues through the SAME engine as
-- the give-and-get loop (reward_events -> reward_ledger, held -> released).
--
-- The rule config already exists: reward_rules with trigger 'ugc_post', a
-- platform/format, and either a flat amount_cents or reach-band `tiers`
-- ([{min_reach,max_reach,amount_cents}]) that computeAmountCents already reads.
-- This migration only adds the submission (the thing a human reviews).
--
-- Service-role-only RLS, like the rest of the rewards tables (0059).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.social_submissions (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores(id) on delete cascade,
  campaign_id    uuid not null references public.reward_campaigns(id) on delete cascade,
  rule_id        uuid references public.reward_rules(id) on delete set null,
  member_id      uuid not null references public.store_members(id) on delete cascade,
  platform       text,                              -- 'instagram'|'facebook'|'youtube'
  format         text,                              -- 'reel'|'post'|'story'|'video'
  post_url       text not null,
  claimed_reach  integer,                           -- entered by the reviewer (for banded credit)
  disclosure_confirmed boolean not null default false,  -- #ad/#gifted confirmed
  status         text not null default 'submitted'
                   check (status in ('submitted','approved','rejected')),
  reviewed_by    uuid references public.staff(id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text,
  -- Set when approved: the accrual this submission produced (idempotency anchor).
  reward_event_id uuid references public.reward_events(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index social_submissions_queue_idx on public.social_submissions(store_id, status);
create index social_submissions_member_idx on public.social_submissions(member_id);
-- One live submission per (member, post_url) — stop double-submitting the same post.
create unique index social_submissions_dedupe_uq
  on public.social_submissions(campaign_id, member_id, post_url)
  where status <> 'rejected';

alter table public.social_submissions enable row level security; -- service-role + panel admin only

comment on table public.social_submissions is
  'Post-for-credit submissions awaiting manual review. On approval, credit accrues via reward_events/reward_ledger. Reject leaves no ledger entry.';
