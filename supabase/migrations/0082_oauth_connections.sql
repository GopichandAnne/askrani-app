-- 0082_oauth_connections — the OAuth broker's token vault.
--
-- One row per (store, provider) the owner has connected (Google, Square, HubSpot,
-- …). Access/refresh tokens are stored ENCRYPTED at the application layer
-- (AES-GCM with OAUTH_ENC_KEY) — never plaintext, never seen by the model. Only
-- the service-role edge functions (oauth-start / oauth-callback and the token
-- helper) read/write this; RLS is on with no client policies.

create table if not exists oauth_connection (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references stores(id) on delete cascade,
  provider       text not null,                    -- 'google' | 'square' | 'hubspot' | …
  access_token   text not null,                    -- AES-GCM ciphertext (base64)
  refresh_token  text,                             -- AES-GCM ciphertext (base64), if the provider issues one
  expires_at     timestamptz,                      -- when the access token expires (for refresh)
  scope          text,                             -- granted scopes (space-separated)
  account_label  text,                             -- human label from the provider (email / merchant / portal)
  status         text not null default 'connected',-- connected | revoked | error
  connected_by   uuid,                             -- staff user who connected it
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (store_id, provider)
);

create index if not exists oauth_connection_store_idx on oauth_connection (store_id) where status = 'connected';

alter table oauth_connection enable row level security;
-- No client policies on purpose — only the service-role broker touches tokens.
