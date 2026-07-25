-- 0071 — "Popular" / most-ordered products, for the diner's Popular tab.
--
-- Aggregates how often each sku appears across the store's orders in the last 90
-- days (excluding cancelled/rejected), and returns the top in-stock products in the
-- same shape browse_products emits so the diner renders them identically. No new
-- table — computed on demand; a store with no order history returns [].

create or replace function public.popular_products(
  p_store_id    uuid,
  p_show_prices boolean default true,
  p_limit       int default 24
)
returns json
language sql
security definer
stable
set search_path = public, extensions
as $$
  with counts as (
    select (it->>'sku') as sku,
           sum(coalesce(nullif(it->>'quantity', '')::numeric, 1)) as qty
    from public.orders o
    join public.stores s on s.slug = o.store_slug and s.id = p_store_id
    cross join lateral jsonb_array_elements(o.items_json) it
    where o.status not in ('cancelled', 'rejected')
      and o.created_at > now() - interval '90 days'
      and coalesce(it->>'sku', '') <> ''
    group by 1
  ),
  top as (
    select p.sku, p.name, p.brand, p.size, p.unit, p.price, p.currency, p.category,
           p.image_url, p.in_stock, p.allergens, p.dietary, p.modifiers, c.qty
    from counts c
    join public.products p
      on p.store_id = p_store_id and p.sku = c.sku and p.in_stock
    order by c.qty desc, p.name
    limit greatest(p_limit, 1)
  )
  select coalesce(
    json_agg(json_build_object(
      'sku', t.sku, 'name', t.name, 'brand', t.brand, 'size', t.size, 'unit', t.unit,
      'price', case when p_show_prices then t.price else null end,
      'currency', t.currency, 'category', t.category, 'image_url', t.image_url,
      'in_stock', t.in_stock, 'allergens', t.allergens, 'dietary', t.dietary,
      'modifiers', t.modifiers
    ) order by t.qty desc, t.name),
    '[]'::json
  )
  from top t;
$$;

grant execute on function public.popular_products(uuid, boolean, int) to service_role, authenticated;
