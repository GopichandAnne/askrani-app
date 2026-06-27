-- ═══════════════════════════════════════════════════════════════════════════
-- 0001 — extensions + enum types
-- Ask Rani admin panel. Schemas match the live AskRani-WA Sheets exactly.
-- Apply in order with `supabase db push`. STOP for human review before applying.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;        -- gen_random_uuid()

-- ── Order lifecycle (lowercase, real lifecycle — no draft/fulfilled) ─────────
create type public.order_status as enum (
  'placed',
  'submitted',
  'pending_approval',
  'proposed',
  'confirmed',
  'rejected',
  'cancelled'
);

create type public.fulfillment_type as enum ('pickup', 'delivery');

create type public.order_mode as enum ('standard', 'request');

-- ── Conversations / threads ─────────────────────────────────────────────────
create type public.routing_state as enum ('idle', 'active_owner_handling');

create type public.message_direction as enum ('inbound', 'outbound', 'system');

create type public.message_kind as enum ('message', 'event');

create type public.device_type as enum ('whatsapp', 'web');

-- ── Tickets (ephemeral cache mirror) ────────────────────────────────────────
create type public.ticket_status as enum (
  'created',
  'sent_to_owner',
  'answered',
  'timed_out'
);

-- ── Staff / access ──────────────────────────────────────────────────────────
create type public.staff_role as enum ('owner', 'staff');

create type public.staff_status as enum ('active', 'inactive');

-- ── Agent configuration keys (Option B: Postgres = source of truth) ─────────
create type public.agent_config_key as enum (
  'personality',
  'off_topic_handling',
  'language_handling',
  'engage_info',
  'store_prompt',
  'suggestion_chips',
  'tax_rate',
  'history_turns'
);

-- NOTE: thread_messages.event_type is intentionally kept as TEXT (not an enum).
-- The bot is out of scope and may emit new event types; an enum would force a
-- migration every time. Known values: order_created, order_proposed,
-- order_confirmed, order_cancelled, ticket_opened, ticket_resolved,
-- routing_state_changed.
