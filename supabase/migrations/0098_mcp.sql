-- MCP servers — Bot Phase 6b.
-- An owner can connect a remote (Streamable-HTTP) MCP server; we discover its
-- tools (tools/list) and register them so Rani can call them BY CONTEXT at chat
-- time (tools/call), exactly like the builder's http_tool. Store-level auth only
-- (reuses the OAuth broker + the encrypted key vault); the model never sees creds.
-- Accessed only via the service-role `mcp` edge function → RLS on, no policies.

create table if not exists public.mcp_server (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  name        text not null,
  url         text not null,                       -- the server's Streamable-HTTP endpoint
  auth        jsonb not null default '{"type":"none"}'::jsonb,
  api_key     text,                                -- AES-GCM encrypted, for auth.type='apikey'
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists mcp_server_store_idx on public.mcp_server (store_id);

create table if not exists public.mcp_tool (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  server_id     uuid not null references public.mcp_server(id) on delete cascade,
  name          text not null,                     -- namespaced name exposed to the model
  remote_name   text not null,                     -- the server's own tool name (for tools/call)
  description   text not null default '',
  input_schema  jsonb not null default '{"type":"object","properties":{}}'::jsonb,
  side_effect   boolean not null default false,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (server_id, remote_name)
);
create index if not exists mcp_tool_store_idx on public.mcp_tool (store_id);

alter table public.mcp_server enable row level security;
alter table public.mcp_tool   enable row level security;
