# Edge Functions — the Ask Rani bot

Native Deno/TypeScript rebuild of the AskRani-WA bot, writing directly to the
same Supabase Postgres the panel uses. The Apps Script files are the behavioral
spec; this is a clean reimplementation (service-role, bypasses RLS).

## `whatsapp-webhook` (Phase 1)

Meta WhatsApp Cloud API inbound webhook.

- `GET`  — verification handshake (`hub.challenge` / `WA_VERIFY_TOKEN`).
- `POST` — verifies `X-Hub-Signature-256` over the raw body, **200-ACKs
  immediately**, then in the background: routes to the store by
  `phone_number_id`, **dedups on `wamid`** (deterministic `message_id`),
  upserts the `threads` row, persists the inbound to `thread_messages`
  (append-only), and sends a canned reply.

No conversation/LLM yet (Phase 2). `verify_jwt = false` in `config.toml` (Meta
can't send a Supabase JWT; the HMAC check is the auth).

## Run locally

```bash
supabase start
cp supabase/functions/.env.example supabase/functions/.env   # fill WA_VERIFY_TOKEN, WA_APP_SECRET
supabase functions serve whatsapp-webhook --env-file supabase/functions/.env
# served at http://localhost:54321/functions/v1/whatsapp-webhook
```

To exercise it you need a store row whose `whatsapp_phone_number_id` matches the
test payload's `metadata.phone_number_id`.

## Deploy

```bash
supabase functions deploy whatsapp-webhook
supabase secrets set WA_VERIFY_TOKEN=... WA_APP_SECRET=...
# per-store WhatsApp access tokens live in the store_secrets table (service-role)
```

Then point Meta's webhook at
`https://<ref>.functions.supabase.co/whatsapp-webhook` with your verify token,
subscribed to the **messages** field.
