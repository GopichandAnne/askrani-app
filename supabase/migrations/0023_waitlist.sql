-- ═══════════════════════════════════════════════════════════════════════════
-- 0023 — waitlist signups (public marketing form)
--
-- The askrani.ai marketing site posts early-access signups here via a Next.js
-- server action using the ANON key. RLS allows anonymous INSERT only — no one
-- can read signups back through the API (owners read via service role / panel).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_name text not null,
  business_type text,
  city text,
  state text,
  full_name text not null,
  email text not null,
  phone text,
  hear_about text,
  comments text,
  source text not null default 'website'
);

alter table public.waitlist enable row level security;

-- Public form: anonymous + authenticated may INSERT; there is deliberately no
-- SELECT/UPDATE/DELETE policy, so signups are not readable via the anon/auth API.
grant insert on public.waitlist to anon, authenticated;

create policy "waitlist_insert_public" on public.waitlist
  for insert to anon, authenticated
  with check (true);
