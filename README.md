# Ask Rani — Staff/Owner Control Panel

Internal control panel for **Ask Rani** (brand) / **Vaayu Group LLC**: the staff +
owner back office for the AI shopping assistant ("Rani") that runs over WhatsApp +
web chat from the separate `AskRani-WA` Apps Script project.

> The customer-facing bot is **out of scope to modify**. This panel mirrors its
> data and (later) dual-writes; it never changes conversation logic.

**Stack:** Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · Supabase
(Postgres + Auth + Realtime + RLS) · deploy to Vercel.

---

## Status — Phase 1 complete (scaffold + schema + RLS)

This PR contains, per the kickoff brief, **no product UI yet**:

- ✅ Next.js + TS + Tailwind + shadcn/ui scaffold (hand-authored, install-ready)
- ✅ `app/tokens.css` — brand design tokens, single source of truth
- ✅ Full Postgres schema — `supabase/migrations/0001…0006`
- ✅ RLS on every table + helper functions + policies + grants
- ✅ `RLS_TESTS.md` + pgTAP test `supabase/tests/rls_test.sql` — **all 12 pass**
  on the local stack (`supabase test db` → `Result: PASS`)
- ✅ `.env.local` (blank values) + `.env.example` (documented)

**Next:** human review of RLS, then Phase 2 (App shell + Orders realtime screen).

---

## Getting started

> ⚠️ **HUMAN TODO (tooling):** Node.js is **not installed** on the dev machine
> this was scaffolded on. Install **Node 20+** first; nothing below runs without
> it. For the RLS test you also need **Docker Desktop** + the **Supabase CLI**.

```bash
# 1. install dependencies (after Node is installed)
npm install

# 2. fill in secrets — copy the contract and edit values
cp .env.example .env.local        # then fill NEXT_PUBLIC_SUPABASE_URL etc.

# 3. apply the schema (review FIRST — see RLS_TESTS.md gate)
supabase link --project-ref <your-project-ref>
supabase db push

# 4. run the RLS gate — must pass before building UI
supabase start
supabase test db

# 5. dev server (Phase 2+)
npm run dev
```

shadcn/ui is configured (`components.json`); add components later with e.g.
`npx shadcn@latest add button`.

---

## Layout

```
app/
  tokens.css        brand tokens (SoT)        globals.css   semantic (shadcn) mapping
  layout.tsx        fonts (Playfair/DM Sans)  page.tsx      Phase 1 placeholder
lib/
  utils.ts          cn() helper
  supabase/
    client.ts       browser client (anon)
    server.ts       SSR client (anon + cookies)
    admin.ts        SERVICE-ROLE client — server-only, bypasses RLS
supabase/
  config.toml       CLI config
  migrations/       0001 enums · 0002 tables · 0003 rls helpers · 0004 policies · 0005 seed · 0006 grants
  tests/rls_test.sql  pgTAP cross-store isolation test
RLS_TESTS.md        security model + how to run the gate
```

---

## Design system (from the production askrani.ai stylesheet)

All brand values live in [`app/tokens.css`](app/tokens.css) and are surfaced to
Tailwind via [`app/globals.css`](app/globals.css) + `tailwind.config.ts`. Do not
invent brand colors — derive from tokens. Primary teal `#14B8A6`, coral accent
(sparing), Playfair Display (display/headings, with restraint) + DM Sans (UI).
Dark mode is class-based (navy base), persisted via `next-themes` (wired in
Phase 2). `prefers-reduced-motion` is respected in `globals.css`.

---

## Open HUMAN TODOs (carried forward)

These need a console/account action no code can perform:

1. **Install Node 20+** (build) and **Supabase CLI + Docker** (RLS test). _(tooling)_
2. **Fill `.env.local`** — Supabase URL/anon key, `SUPABASE_SERVICE_ROLE_KEY`
   (server-only), `GOOGLE_SERVICE_ACCOUNT_JSON` (server-only).
3. **Google OAuth (Phase: Auth)** — create the OAuth client in Google Cloud and
   the Google provider in Supabase Auth. ⚠️ The **authorized redirect URI must
   exactly match** `https://<project-ref>.supabase.co/auth/v1/callback` — this is
   the #1 failure point.
4. **Google service account (Phase: Agent Config)** — create it and share each
   store's Drive folder (`store_folder_id`) with the service-account email.
5. **Cache-invalidation seam (Phase: Agent Config)** — confirm whether writing the
   Drive file alone invalidates the bot's prompt cache, or whether the render step
   must call an Apps Script endpoint / null `current_cache_name`.
6. **Run migrations only after RLS review** — do not `supabase db push` to a shared
   DB until `RLS_TESTS.md` is signed off.

---

## Hard rules (enforced going forward)

- Never commit secrets; `.env.local` is gitignored. Service-role key +
  service-account JSON are server-only.
- WhatsApp tokens live in `store_secrets` (service-role only), never a
  client-readable table.
- Realtime on Orders is mandatory (Phase 2).
- RLS on every table; `thread_messages` is append-only; reviewed before merge.
- Carts stay cache-first; tickets ephemeral — mirrored for display only.
- Do NOT modify `AskRani-WA` conversation logic; dual-write is additive.
- One PR per phase; **stop for review after RLS and before migration**.
