-- Anti-farming for post-for-credit: bind ONE verified social handle per member
-- per platform, and ensure a handle belongs to exactly one member. Kills the
-- "rotate throwaway Instagram accounts to farm credit" vector without hurting a
-- real guest (who has one handle). Handle is stored normalized (lowercase, no @).
create table if not exists public.member_social_handles (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  member_id   uuid not null references public.store_members(id) on delete cascade,
  platform    text not null,               -- 'instagram' | 'tiktok' | 'youtube' | 'facebook'
  handle      text not null,               -- normalized: lowercase, leading '@' stripped
  created_at  timestamptz not null default now(),
  -- one handle ↔ one member (per store, per platform)
  unique (store_id, platform, handle),
  -- one handle per member (per store, per platform)
  unique (store_id, platform, member_id)
);
create index if not exists member_social_handles_member_idx
  on public.member_social_handles(store_id, member_id);
