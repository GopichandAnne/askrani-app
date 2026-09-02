-- ═══════════════════════════════════════════════════════════════════════════
-- 0103 — per-store model choice. Let a store pick which LLM answers its chat
-- (Gemini / Anthropic / OpenAI). NULL provider ⇒ Gemini, so every existing store
-- keeps its current behavior untouched. model_name pins the exact model within
-- the provider (e.g. 'claude-sonnet-5', 'gpt-4o-mini'); NULL ⇒ the adapter default.
-- Keys are platform-level env (ANTHROPIC_API_KEY / OPENAI_API_KEY).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.stores add column if not exists model_provider text;
alter table public.stores add column if not exists model_name text;

alter table public.stores drop constraint if exists stores_model_provider_check;
alter table public.stores add constraint stores_model_provider_check
  check (model_provider is null or model_provider in ('gemini', 'anthropic', 'openai'));
