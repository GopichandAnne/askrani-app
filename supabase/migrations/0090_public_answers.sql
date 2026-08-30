-- ═══════════════════════════════════════════════════════════════════════════
-- 0090 — public Answers surface (the AEO fill)
--
-- public_answers(slug): the store's confirmed Q&A + basic facts, as JSON, ONLY
-- when the owner has published (agent_config answers_published = 'true') and the
-- store is active. Rendered SSR + schema.org at askrani.ai/a/<slug> so answer
-- engines can read it — same data the on-site assistant uses, no site rewrite.
--
-- published_answer_slugs(): the published set, for the sitemap.
-- Both anon-granted, security definer, public data only.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.public_answers(p_slug text)
returns json
language sql
security definer
stable
set search_path = public
as $$
  select json_build_object(
    'slug', s.slug,
    'name', coalesce(s.store_display_name, s.slug),
    'business_type', s.business_type,
    'logo_url', s.logo_url,
    'phone', s.whatsapp_display_number,
    'hours', (
      select c.value from public.agent_config c
      where c.store_id = s.id and c.key = 'store_hours' limit 1
    ),
    'updated_at', greatest(
      s.updated_at,
      coalesce((select max(q.updated_at) from public.saved_qa q where q.store_id = s.id and q.active), s.updated_at)
    ),
    'faqs', coalesce((
      select json_agg(json_build_object('q', t.question, 'a', t.answer))
      from (
        select question, answer
        from public.saved_qa
        where store_id = s.id and active and answer is not null and btrim(answer) <> ''
        order by times_used desc, updated_at desc
        limit 60
      ) t
    ), '[]'::json)
  )
  from public.stores s
  where s.slug = p_slug and s.active
    and coalesce((
      select lower(btrim(c.value)) = 'true' from public.agent_config c
      where c.store_id = s.id and c.key = 'answers_published' limit 1
    ), false)
  limit 1;
$$;

grant execute on function public.public_answers(text) to anon, authenticated;

create or replace function public.published_answer_slugs()
returns table(slug text, updated_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select s.slug,
    greatest(
      s.updated_at,
      coalesce((select max(q.updated_at) from public.saved_qa q where q.store_id = s.id and q.active), s.updated_at)
    )
  from public.stores s
  where s.active
    and coalesce((
      select lower(btrim(c.value)) = 'true' from public.agent_config c
      where c.store_id = s.id and c.key = 'answers_published' limit 1
    ), false)
  order by 2 desc
  limit 5000;
$$;

grant execute on function public.published_answer_slugs() to anon, authenticated;
