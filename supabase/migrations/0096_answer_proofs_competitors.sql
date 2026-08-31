-- ═══════════════════════════════════════════════════════════════════════════
-- 0096 — who's winning the discovery (competitors on context probes)
--
-- For non-branded "context" probes, we record which companies/products the engine
-- recommends for those intents — the roadmap of who you're losing discovery to.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.answer_proofs add column if not exists competitors jsonb not null default '[]'::jsonb;
