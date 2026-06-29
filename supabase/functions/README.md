# Edge Functions — the Ask Rani bot

Native Deno/TypeScript rebuild of the AskRani-WA bot, writing directly to the
same Supabase Postgres the panel uses. The Apps Script files are the behavioral
spec; this is a clean reimplementation (service-role, bypasses RLS).

## `whatsapp-webhook` (Phases 1–2)

Meta WhatsApp Cloud API inbound webhook.

- `GET`  — verification handshake (`hub.challenge` / `WA_VERIFY_TOKEN`).
- `POST` — verifies `X-Hub-Signature-256` over the raw body, **200-ACKs
  immediately**, then in the background: routes to the store by
  `phone_number_id`, **dedups on `wamid`** (deterministic `message_id`),
  upserts the `threads` row, persists the inbound to `thread_messages`
  (append-only), and hands off to the conversation core.

`verify_jwt = false` in `config.toml` (Meta can't send a Supabase JWT; the HMAC
check is the auth).

## Conversation core (Phase 2) — `_shared/`

One inbound turn flows: **routing gate → load history → assemble prompt →
Gemini → log turn + reply**.

- **Routing gate** (`prompt.ts` `shouldBotRespond`) — when a thread's
  `routing_state` is `active_owner_handling`, the bot stays silent.
- **History** (`history.ts`) — last `history_turns` rows from `conversations`
  for `session_id = wa_<phone>`, oldest-first.
- **Prompt assembly** (`prompt.ts`) — **prefix-first for implicit caching**:
  the stable `systemInstruction` (store config + KB from `agent_config` /
  `saved_qa`) never varies turn-to-turn, and the new message is appended
  **last**, so each turn's prompt is a prefix of the next.
- **Gemini** (`gemini.ts`) — AI Studio key path (`GEMINI_API_KEY`), default
  model `gemini-2.5-flash`. **No key → returns null and the bot stays quiet**
  (the inbound is still persisted), so it's safe to deploy before the key.
- **Logging** — the turn → `conversations` (with a `language` tag in
  `analytics_json`); the reply → `thread_messages` (outbound, append-only).

## Run locally

```bash
supabase start
cp supabase/functions/.env.example supabase/functions/.env   # WA_VERIFY_TOKEN, WA_APP_SECRET, GEMINI_API_KEY
supabase functions serve whatsapp-webhook --env-file supabase/functions/.env
# served at http://localhost:54321/functions/v1/whatsapp-webhook
```

To exercise it you need a store row whose `whatsapp_phone_number_id` matches the
test payload's `metadata.phone_number_id`.

## Test

```bash
deno test -A supabase/functions/whatsapp-webhook/index.test.ts   # signature gate
deno test supabase/functions/_shared/prompt.test.ts              # prompt assembly + cacheability
deno test --allow-env supabase/functions/_shared/gemini.test.ts  # no-key guard
```

`index.test.ts` locks the signature boundary: missing / wrong / wrong-body
signatures all → 401, only a valid signature passes the gate, GET verify token
honored. `prompt.test.ts` asserts the prefix-first cacheability contract (stable
system instruction, new message appended last) plus history shaping, routing
gate, and language detection — all without the key or a DB. (Run with a
standalone Deno — the bundled `supabase functions serve` has a Windows spawn bug.)

## Deploy

```bash
supabase functions deploy whatsapp-webhook
supabase secrets set WA_VERIFY_TOKEN=... WA_APP_SECRET=... GEMINI_API_KEY=...
# per-store WhatsApp access tokens live in the store_secrets table (service-role)
```

Then point Meta's webhook at
`https://<ref>.functions.supabase.co/whatsapp-webhook` with your verify token,
subscribed to the **messages** field.
