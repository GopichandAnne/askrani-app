-- 0083_http_tools — the builder brain's output: generated direct-HTTP tools.
--
-- The owner points Rani at an API (an OpenAPI URL + what they want); the builder
-- (integration-build) reads the spec, picks the operations, and writes one row per
-- tool here — endpoint, method, how the tool's args map to path/query/body, the
-- tool's JSON-Schema params, and how it authenticates. A generic executor
-- (_shared/httptool.ts) runs them; the bot picks them up like any other tool.
--
-- Any API key is AES-GCM encrypted (same OAUTH_ENC_KEY as the broker); OAuth-authed
-- tools reference a broker connection instead of storing a secret. RLS on, and
-- writes go through the service-role builder function.

create table if not exists http_tool (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references stores(id) on delete cascade,
  name         text not null,                                             -- tool name (snake_case)
  description  text not null,                                             -- what the bot reads
  method       text not null default 'GET',
  base_url     text not null,
  path         text not null,                                             -- e.g. /v1/orders/{id}
  params       jsonb not null default '{"type":"object","properties":{},"required":[]}'::jsonb,
  request_map  jsonb not null default '[]'::jsonb,                        -- [{param, in: path|query|body}]
  auth         jsonb not null default '{"type":"none"}'::jsonb,           -- {type, location, name, prefix, provider}
  api_key      text,                                                      -- AES-GCM ciphertext (base64), if auth.type='apikey'
  side_effect  boolean not null default false,
  enabled      boolean not null default true,
  timeout_ms   integer not null default 6000,
  created_at   timestamptz not null default now(),
  unique (store_id, name)
);

create index if not exists http_tool_store_idx on http_tool (store_id) where enabled;

alter table http_tool enable row level security;
-- Read/written by the service-role builder + bot; no client policies.
