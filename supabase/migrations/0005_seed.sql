-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 — seed
-- Idempotent (safe to re-run). Seeds the two known stores and their default
-- agent-config settings. The full row data is backfilled by
-- scripts/migrate-from-sheets.ts from the Stores Config Sheet.
--
-- tax_rate / history_turns live in agent_config (Option B source of truth):
--   TEXAS_TAX_RATE was hardcoded 0.0825 in Orders.gs -> now a per-store setting.
--   HISTORY_TURNS -> per-store setting (default 10; confirm real value on import).
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.stores (slug, active, store_display_name, business_type)
values
  ('man-pasand-lakeline',  true, 'Man Pasand (Lakeline)',       'grocery'),
  ('foodistan-cedar-park', true, 'Foodistan (Cedar Park)',      'restaurant')
on conflict (slug) do nothing;

-- Default agent-config settings for each store.
insert into public.agent_config (store_id, key, value, version)
select s.id, 'tax_rate'::public.agent_config_key, '0.0825', 1
from public.stores s
where s.slug in ('man-pasand-lakeline', 'foodistan-cedar-park')
on conflict (store_id, key) do nothing;

insert into public.agent_config (store_id, key, value, version)
select s.id, 'history_turns'::public.agent_config_key, '10', 1
from public.stores s
where s.slug in ('man-pasand-lakeline', 'foodistan-cedar-park')
on conflict (store_id, key) do nothing;
