-- =============================================================================
-- Inteligência: preços por MARCA/APRESENTAÇÃO dentro do produto genérico
-- =============================================================================
-- O produto do estoque é genérico ("Pão de forma"), mas preço se compara entre
-- itens iguais. Cada linha de compra ganha uma "variante":
--   * pelo código de barras da nota (EAN), quando houver;
--   * senão, pela descrição normalizada do cupom ("PAO FORMA SEVEN BOYS 450G").
-- O comparador de mercados, a economia potencial e as estatísticas de preço
-- passam a agrupar por variante — nunca comparam marcas diferentes.
-- Também calcula o preço por kg/L a partir do tamanho escrito na descrição
-- ("450G", "1,5KG", "500ML", "C/5" multiplica), para comparar marcas entre si.
-- =============================================================================

-- Tamanho escrito na descrição, em kg ou L. Null se não houver.
create or replace function private.parse_size(p_description text, out qty numeric, out base text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  m    text[];
  mult numeric := 1;
  n    numeric;
  u    text;
begin
  m := regexp_match(upper(coalesce(p_description, '')), '(\d+(?:[.,]\d+)?)\s*(KG|GR|G|ML|LT|L)(?![A-Z])');
  if m is null then return; end if;
  n := replace(m[1], ',', '.')::numeric;
  u := m[2];
  if n is null or n <= 0 then return; end if;
  -- "C/5", "CX12", "CX 12": embalagem com várias unidades do tamanho indicado
  if upper(p_description) ~ '(C/|CX)\s*\d+' then
    mult := coalesce((regexp_match(upper(p_description), '(?:C/|CX)\s*(\d+)'))[1]::numeric, 1);
    if mult <= 0 or mult > 100 then mult := 1; end if;
  end if;
  if u in ('G', 'GR') then qty := n / 1000 * mult; base := 'kg';
  elsif u = 'KG' then qty := n * mult; base := 'kg';
  elsif u = 'ML' then qty := n / 1000 * mult; base := 'L';
  else qty := n * mult; base := 'L';
  end if;
  qty := trim_scale(round(qty, 4));
end;
$$;

-- Linhas com variante (marca/apresentação) e preço por kg/L.
create or replace function private.intel_price_lines(
  p_household_id uuid, p_from date, p_to date, p_store text, p_category uuid, p_product uuid, p_brand uuid
)
returns table (
  purchase_id uuid, local_date date, store_key text, store_name text,
  item_id uuid, household_product_id uuid, product_name text, category_name text, brand_name text,
  quantity numeric, unit text, total_price numeric, discount numeric, unit_net numeric,
  variant_key text, variant_label text, price_per_base numeric, base_unit text
)
language sql
stable
set search_path = ''
as $$
  select l.purchase_id, l.local_date, l.store_key, l.store_name,
         l.item_id, l.household_product_id, l.product_name, l.category_name, l.brand_name,
         l.quantity, l.unit, l.total_price, l.discount, l.unit_net,
         case when i.ean is not null then 'e:' || i.ean
              else 'd:' || coalesce(private.normalize_text(i.description), i.id::text) end,
         i.description,
         case when l.unit = 'KG' then l.unit_net
              when l.unit = 'L' then l.unit_net
              when sz.qty > 0 then round(l.unit_net / sz.qty, 4) end,
         case when l.unit = 'KG' then 'kg' when l.unit = 'L' then 'L' else sz.base end
    from private.intel_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand) l
    join public.purchase_items i on i.id = l.item_id
    left join lateral private.parse_size(i.description) sz on true
   where l.household_product_id is not null;
$$;

-- -----------------------------------------------------------------------------
-- Economia potencial: só a MESMA variante em outro mercado
-- -----------------------------------------------------------------------------
drop function if exists private.intel_savings(uuid, date, date, text, uuid, uuid, uuid);
create function private.intel_savings(
  p_household_id uuid, p_from date, p_to date, p_store text, p_category uuid, p_product uuid, p_brand uuid
)
returns table (
  household_product_id uuid, product_name text, variant_label text, unit text, lines int, quantity numeric,
  paid numeric, saving numeric, best_store_name text, best_price numeric
)
language sql
stable
set search_path = ''
as $$
  with l as (
    select * from private.intel_price_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)
  ),
  obs as (
    select * from private.intel_price_lines(p_household_id, p_from - 90, p_to + 90, null, p_category, p_product, p_brand)
  ),
  per_line as (
    select l.household_product_id, l.product_name, l.variant_key, l.variant_label, l.unit, l.quantity, l.total_price, l.unit_net,
           best.unit_net as best_price, best.store_name as best_store
      from l
      join lateral (
        select o.unit_net, o.store_name
          from obs o
         where o.variant_key = l.variant_key
           and o.unit = l.unit
           and o.store_key <> l.store_key
           and o.local_date between l.local_date - 90 and l.local_date + 90
         order by o.unit_net, o.local_date desc
         limit 1
      ) best on true
  )
  select min(household_product_id::text)::uuid, min(product_name),
         (array_agg(variant_label))[1], unit, count(*)::int, sum(quantity),
         sum(total_price),
         round(sum(greatest(0, (unit_net - best_price) * quantity)), 2),
         (array_agg(best_store order by best_price))[1],
         min(best_price)
    from per_line
   group by variant_key, unit;
$$;

-- -----------------------------------------------------------------------------
-- Supermercados: cesta comparável por variante
-- -----------------------------------------------------------------------------
create or replace function public.intel_stores(
  p_household_id uuid, p_from date, p_to date,
  p_store text default null, p_category uuid default null, p_product uuid default null, p_brand uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items  boolean := p_category is not null or p_product is not null or p_brand is not null;
  v_wfrom  date := least(p_from, p_to - 89);
  v_result jsonb;
begin
  perform private.intel_guard(p_household_id, p_from, p_to);

  with l as (select * from private.intel_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)),
       pu as (select * from private.intel_purchases(p_household_id, p_from, p_to, p_store)
               where not v_items or purchase_id in (select purchase_id from l)),
       pv as (
         select p.*, case when v_items then (select sum(total_price) from l where l.purchase_id = p.purchase_id) else p.total end as value
           from pu p
       ),
       ranking as (
         select store_key, (array_agg(store_name order by at desc))[1] as store_name,
                count(*) as visits, sum(value) as total, round(avg(value), 2) as avg_ticket, max(local_date) as last_visit
           from pv group by store_key
       ),
       w as (select * from private.intel_price_lines(p_household_id, v_wfrom, p_to, null, p_category, p_product, p_brand)),
       latest as (
         select distinct on (variant_key, unit, store_key)
                household_product_id, variant_key, variant_label, unit, store_key, store_name, product_name, unit_net, local_date, discount
           from w
          order by variant_key, unit, store_key, local_date desc, unit_net
       ),
       comparable as (
         select variant_key, unit from latest group by variant_key, unit having count(distinct store_key) >= 2
       ),
       basket as (
         select lt.*, min(lt.unit_net) over (partition by lt.variant_key, lt.unit) as min_price,
                max(lt.unit_net) over (partition by lt.variant_key, lt.unit) as max_price
           from latest lt join comparable c using (variant_key, unit)
       ),
       store_index as (
         select store_key, (array_agg(store_name))[1] as store_name,
                count(*) as compared, count(*) filter (where unit_net = min_price) as wins,
                round(avg(case when min_price > 0 then unit_net / min_price end), 4) as price_index
           from basket group by store_key
       )
  select jsonb_build_object(
    'window', jsonb_build_object('from', v_wfrom, 'to', p_to),
    'stores_with_prices', (select count(distinct store_key) from latest),
    'ranking', coalesce((select jsonb_agg(jsonb_build_object(
                           'store_key', store_key, 'store_name', store_name, 'visits', visits, 'total', total,
                           'avg_ticket', avg_ticket, 'last_visit', last_visit,
                           'share', case when (select sum(total) from ranking) > 0 then round(total / (select sum(total) from ranking), 4) else 0 end)
                           order by total desc) from ranking), '[]'::jsonb),
    'price_index', coalesce((select jsonb_agg(jsonb_build_object(
                               'store_key', store_key, 'store_name', store_name, 'compared', compared, 'wins', wins, 'index', price_index)
                               order by price_index, wins desc) from store_index), '[]'::jsonb),
    'basket', coalesce((select jsonb_agg(x order by (x ->> 'spread_pct')::numeric desc nulls last) from (
                          select jsonb_build_object(
                                   'household_product_id', min(household_product_id::text)::uuid,
                                   'product_name', min(product_name),
                                   'variant_label', (array_agg(variant_label order by local_date desc))[1],
                                   'unit', unit,
                                   'min_price', min(min_price),
                                   'max_price', max(max_price),
                                   'spread_pct', private.pct(max(max_price), min(min_price)),
                                   'best_store_key', (array_agg(store_key order by unit_net, local_date desc))[1],
                                   'best_store_name', (array_agg(store_name order by unit_net, local_date desc))[1],
                                   'prices', jsonb_agg(jsonb_build_object('store_key', store_key, 'store_name', store_name,
                                                                          'price', unit_net, 'date', local_date, 'discount', discount > 0)
                                                       order by unit_net)) as x
                            from basket group by variant_key, unit) b), '[]'::jsonb),
    'savings', coalesce((select jsonb_agg(jsonb_build_object(
                           'household_product_id', household_product_id, 'product_name', product_name, 'variant_label', variant_label,
                           'unit', unit, 'lines', lines, 'quantity', quantity, 'paid', paid, 'saving', saving,
                           'best_store_name', best_store_name, 'best_price', best_price) order by saving desc)
                           from private.intel_savings(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)
                          where saving > 0), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Preços: uma linha por variante (marca/apresentação) de cada produto genérico
-- -----------------------------------------------------------------------------
create or replace function public.intel_prices(
  p_household_id uuid, p_from date, p_to date,
  p_store text default null, p_category uuid default null, p_product uuid default null, p_brand uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pfrom  date := p_from - (p_to - p_from + 1);
  v_result jsonb;
begin
  perform private.intel_guard(p_household_id, p_from, p_to);

  with l as (select * from private.intel_price_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)),
       prev as (
         select variant_key, unit, sum(total_price) / nullif(sum(quantity), 0) as avg_price
           from private.intel_price_lines(p_household_id, v_pfrom, p_from - 1, p_store, p_category, p_product, p_brand)
          group by variant_key, unit
       ),
       ordered as (
         select l.*, row_number() over (partition by variant_key, unit order by local_date desc, item_id) as rn_desc,
                row_number() over (partition by variant_key, unit order by local_date, item_id) as rn_asc
           from l
       ),
       per_store as (
         select distinct on (variant_key, unit, store_key) variant_key, unit, store_key, store_name, unit_net
           from l order by variant_key, unit, store_key, local_date desc
       ),
       spread as (
         select variant_key, unit, count(*) as stores, min(unit_net) as store_min, max(unit_net) as store_max,
                (array_agg(store_name order by unit_net))[1] as cheapest_store
           from per_store group by variant_key, unit
       ),
       agg as (
         select o.variant_key, o.unit,
                min(o.household_product_id::text)::uuid as household_product_id,
                min(o.product_name) as product_name, min(o.brand_name) as brand_name, min(o.category_name) as category_name,
                max(o.variant_label) filter (where rn_desc = 1) as variant_label,
                max(o.store_name) filter (where rn_desc = 1) as last_store,
                count(*) as observations,
                count(distinct o.local_date) as dates,
                max(o.unit_net) filter (where rn_desc = 1) as last_price,
                max(o.local_date) filter (where rn_desc = 1) as last_date,
                max(o.unit_net) filter (where rn_desc = 2) as prev_price,
                max(o.unit_net) filter (where rn_asc = 1) as first_price,
                min(o.unit_net) as min_price, max(o.unit_net) as max_price,
                round(sum(o.total_price) / nullif(sum(o.quantity), 0), 4) as avg_price,
                max(o.price_per_base) filter (where rn_desc = 1) as price_per_base,
                max(o.base_unit) filter (where rn_desc = 1) as base_unit
           from ordered o group by o.variant_key, o.unit
       )
  select coalesce(jsonb_agg(jsonb_build_object(
           'household_product_id', a.household_product_id,
           'variant_key', a.variant_key || '|' || a.unit,
           'variant_label', a.variant_label,
           'product_name', a.product_name,
           'brand_name', a.brand_name,
           'category_name', a.category_name,
           'unit', a.unit,
           'package_size', pr.package_size,
           'measure_unit', pr.unit,
           'price_per_base', a.price_per_base,
           'base_unit', a.base_unit,
           'last_store', a.last_store,
           'observations', a.observations,
           'last_price', a.last_price,
           'last_date', a.last_date,
           'prev_price', a.prev_price,
           'first_price', a.first_price,
           'min_price', a.min_price,
           'max_price', a.max_price,
           'avg_price', a.avg_price,
           'last_vs_prev_pct', private.pct(a.last_price, a.prev_price),
           'period_change_pct', case when a.dates >= 2 then private.pct(a.last_price, a.first_price) end,
           'range_pct', private.pct(a.max_price, a.min_price),
           'prev_period_avg', round(pv.avg_price, 4),
           'vs_prev_period_pct', private.pct(a.avg_price, pv.avg_price),
           'stores', s.stores,
           'store_spread_pct', case when s.stores >= 2 then private.pct(s.store_max, s.store_min) end,
           'cheapest_store', case when s.stores >= 2 then s.cheapest_store end
         ) order by a.product_name, a.variant_label), '[]'::jsonb)
    into v_result
    from agg a
    join public.household_products hp on hp.id = a.household_product_id
    join public.products pr on pr.id = hp.product_id
    left join prev pv on pv.variant_key = a.variant_key and pv.unit = a.unit
    left join spread s on s.variant_key = a.variant_key and s.unit = a.unit;
  return v_result;
end;
$$;

-- Histórico de preços de um produto genérico, com a variante de cada compra.
drop function if exists public.intel_price_history(uuid, uuid, date, date);
create function public.intel_price_history(
  p_household_id uuid, p_household_product_id uuid, p_from date, p_to date
)
returns table (
  local_date date, store_key text, store_name text, unit text,
  quantity numeric, unit_price numeric, discount numeric, total_price numeric,
  variant_key text, variant_label text, price_per_base numeric, base_unit text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.intel_guard(p_household_id, p_from, p_to);
  return query
    select l.local_date, l.store_key, l.store_name, l.unit, l.quantity, l.unit_net, l.discount, l.total_price,
           l.variant_key || '|' || l.unit, l.variant_label, l.price_per_base, l.base_unit
      from private.intel_price_lines(p_household_id, p_from, p_to, null, null, p_household_product_id, null) l
     where p_household_product_id is not null
     order by l.local_date, l.item_id;
end;
$$;

revoke execute on function public.intel_price_history(uuid, uuid, date, date) from public, anon;
grant execute on function public.intel_price_history(uuid, uuid, date, date) to authenticated;
