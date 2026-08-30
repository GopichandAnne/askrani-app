-- ═══════════════════════════════════════════════════════════════════════════
-- 0089 — answers_published flag (enum value only)
--
-- Gates the public, crawlable Answers page (askrani.ai/a/<slug>) that turns the
-- store's confirmed Q&A into a machine-readable surface for answer engines. Enum
-- value lands in its own migration, committed before 0090 references it.
-- ═══════════════════════════════════════════════════════════════════════════
alter type public.agent_config_key add value if not exists 'answers_published';
