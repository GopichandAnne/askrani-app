-- ═══════════════════════════════════════════════════════════════════════════
-- 0095 — proof tier (gap vs context)
--
-- Answer-engine proofs now come in two kinds: NAMED "gap" probes (does the engine
-- answer a specific fact about you + cite you — the controllable defensive proof)
-- and NON-BRANDED "context" probes (are you discovered/recommended when the asker
-- doesn't know your name — the high-value discovery signal). Tag each row.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.answer_proofs add column if not exists kind text not null default 'gap';
