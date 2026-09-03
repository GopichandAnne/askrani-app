-- ═══════════════════════════════════════════════════════════════════════════
-- 0107 — Slack approvals. When a held action is routed, Rani can post an Approve /
-- Decline message to a Slack channel; a click resolves the SAME action_request row
-- (marks it approved/declined + who), consistent with the Activity page. The owner
-- picks which channel gets these prompts.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.slack_installs add column if not exists approvals_channel text;
