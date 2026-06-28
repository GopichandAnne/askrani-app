# RLS_TESTS.md — Row-Level Security verification

**Gate:** RLS is NOT considered done until the automated test below passes. Do
not apply migrations to a shared/production database or build UI on top of this
schema until then. (Per kickoff brief: "Stop for review.")

This document covers (1) the security model, (2) the automated test and how to
run it, and (3) a manual verification matrix for a live project.

---

## 1. Security model (what these policies guarantee)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `stores` | members of store | platform admin | owner | owner |
| `store_secrets` | **none — service-role only (table grant REVOKED + no policy)** | none | none | none |
| `platform_admins` | **none — service-role only (table grant REVOKED + no policy)** | none | none | none |
| `staff` | members of store | owner | owner | owner |
| `orders` | members of store | any staff | any staff | none (status-only lifecycle) |
| `threads` | members of store | any staff | any staff (routing toggle) | none |
| `thread_messages` | members of store | any staff | **none (append-only)** | **none (append-only)** |
| `conversations` | members of store | service-role | service-role | service-role |
| `carts` | members of store | service-role | service-role | service-role |
| `tickets` | members of store | service-role | service-role | service-role |
| `saved_qa` | members of store | any staff | any staff | any staff |
| `agent_config` | members of store | **owner** | **owner** | **owner** |
| `agent_config_history` | members of store | service-role | none | none |

- "members of store" = `store_id`/`store_slug` resolves through
  `user_store_ids()` / `user_store_slugs()` for `auth.uid()` (active staff rows),
  OR the user is a platform admin (sees all stores).
- `anon` (no session) has **no policy on any table** → reads/writes nothing.
- `service_role` has `BYPASSRLS` → the bot's dual-write and trusted server routes
  are unaffected by these policies. **The service-role key must stay server-only.**
- Helper functions (`is_platform_admin`, `user_store_ids`, `user_store_slugs`,
  `user_is_owner`) are `SECURITY DEFINER` to avoid policy recursion on `staff`.
- Table privileges (`0006_grants.sql`): `anon`/`authenticated` are granted DML on
  public tables (RLS does the row gating), **except** `store_secrets` and
  `platform_admins`, where the grant is **revoked** entirely — a client role
  can't even attempt a query. Defense in depth on top of the missing policy.

### The two guarantees that matter most
1. **Cross-store isolation** — store A staff cannot read store B's
   orders / threads / agent_config (or anything else).
2. **Secret containment** — no client role (anon or authenticated) can ever
   `SELECT` `store_secrets` (WhatsApp tokens). Only the service role can.

---

## 2. Automated test

File: [`supabase/tests/rls_test.sql`](supabase/tests/rls_test.sql) (pgTAP, 12 assertions).

Fixtures: two stores (the seeded `man-pasand-lakeline` / `foodistan-cedar-park`),
three users — userA (owner of A), userB (owner of B), userC (non-owner staff of A).

### Run it

```bash
# Requires Docker Desktop running + Supabase CLI installed.
supabase start          # boots the local Postgres + applies migrations
supabase test db        # runs every file in supabase/tests/
```

`supabase test db` applies all migrations (including the seed) to a fresh local
database, runs the pgTAP file inside a transaction, and rolls back. Expected
output ends with:

```
ok 1 - userA sees exactly one order (own store only)
ok 2 - userA CANNOT read store B orders
ok 3 - userA CANNOT read store_secrets (table privilege revoked)
ok 4 - userA CANNOT read store B threads
ok 5 - userA CANNOT read store B agent_config
ok 6 - userA (owner) CAN update own store agent_config tax_rate
ok 7 - staff C CAN read store A agent_config
ok 8 - staff C (non-owner) CANNOT update agent_config (value unchanged)
ok 9 - staff C (non-owner) CANNOT insert agent_config (RLS violation)
ok 10 - userB CANNOT read store A orders
ok 11 - userB CANNOT read store_secrets (table privilege revoked)
ok 12 - anon (no session) sees zero orders
Result: PASS
```

> **Verified:** all 12 assertions pass on the local Supabase stack
> (`supabase test db` → `Result: PASS`, exit 0).

> **HUMAN TODO (tooling):** Node.js and the Supabase CLI are not yet installed on
> this machine. Install Node 20+ (for `npm install`) and the Supabase CLI +
> Docker Desktop (for `supabase test db`) before running the gate. Until then the
> test file is reviewable but not executable here.

### What each assertion proves
- **1–5** Cross-store isolation for userA: sees only their store's order; zero
  visibility into store B orders/threads/agent_config; `store_secrets` access is
  denied at the table-privilege level (SQLSTATE 42501).
- **6** Owners CAN write their own store's `agent_config` (the update takes effect).
- **7–9** A non-owner staff member can *read* config but cannot *update* (RLS
  `USING` filters the update to 0 rows, so the value stays unchanged) or *insert*
  (hard RLS violation, SQLSTATE 42501).
- **10–11** Symmetric isolation for userB (different store).
- **12** `anon` sees nothing.

---

## 3. Manual verification matrix (live project, optional but recommended)

Run against a **staging** project after `supabase db push`. Create two real
auth users via the dashboard, add `staff` rows linking each to a different store,
then in the SQL editor (or via the app once auth exists) confirm:

| # | Acting as | Action | Expected |
|---|---|---|---|
| M1 | A-staff | `select * from orders` | only store A rows |
| M2 | A-staff | `select * from orders where store_slug = '<B>'` | 0 rows |
| M3 | A-staff | `select * from store_secrets` | 0 rows |
| M4 | A-staff | `select * from threads where store_slug = '<B>'` | 0 rows |
| M5 | A-staff | `update agent_config … (store A)` | 0 rows (non-owner) / N rows (owner) |
| M6 | A-staff | `insert into thread_messages … (store A)` | succeeds |
| M7 | A-staff | `update thread_messages …` | error / 0 rows (append-only) |
| M8 | A-owner | `update stores … (store A)` | succeeds |
| M9 | B-staff | anything scoped to store A | 0 rows / denied |
| M10 | platform admin | `select * from orders` | rows from ALL stores |

To impersonate in the SQL editor without logging in through the app:

```sql
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '<auth.users.id>', 'role', 'authenticated')::text,
  true
);
-- run your SELECT/UPDATE here, then:
reset role;
```

---

## 4. Sign-off checklist (human, before merge)

- [ ] `supabase test db` → **all 12 pgTAP assertions pass**.
- [ ] Spot-checked the manual matrix (M1–M10) on a staging project.
- [ ] Confirmed `store_secrets` and `platform_admins` have **zero** policies.
- [ ] Confirmed `thread_messages` has **no** UPDATE/DELETE policy.
- [ ] Confirmed the service-role key is referenced **only** in server-only modules
      (`lib/supabase/admin.ts` has `import "server-only"`).
- [ ] Reviewed every `using`/`with check` expression in
      [`supabase/migrations/0004_rls_policies.sql`](supabase/migrations/0004_rls_policies.sql).
