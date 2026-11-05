-- =============================================================================
-- Inteligência de compras
-- =============================================================================
-- Funções somente leitura que devolvem análises JÁ AGREGADAS (o navegador não
-- recebe o histórico inteiro). Usam apenas compras CONFIRMADAS e itens não
-- ignorados. Datas no fuso de Brasília. Cada função confere se quem chama é
-- membro da família antes de ler qualquer dado.
--
-- Regras:
--   * Total gasto  = soma do total pago nos comprovantes (sem filtro de item) ou
--                    soma das linhas filtradas (com filtro de categoria/produto/marca).
--   * Ticket médio = total / nº de compras.
--   * Variação %   = (atual − anterior) / anterior × 100; null sem base.
--   * Preço unitário líquido = total pago na linha / quantidade (já com desconto).
--   * "Mesmo produto" = mesmo household_product (mesma marca/apresentação) e mesma
--     unidade da nota (UN, KG...). Produtos não associados nunca são comparados.
--   * Economia potencial = hipotética: quanto teria custado a menos no menor preço
--     visto em OUTRO mercado até 90 dias antes/depois. Não é economia realizada.
-- =============================================================================

create index if not exists purchase_items_household_product_idx
  on public.purchase_items (household_id, household_product_id) where not ignored;
create index if not exists purchases_confirmed_idx
  on public.purchases (household_id, status, purchased_at);
create index if not exists stock_movements_household_type_idx
  on public.stock_movements (household_id, type, created_at);

-- Chave do estabelecimento: CNPJ, ou nome normalizado.
create or replace function private.store_key(p_cnpj text, p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(p_cnpj, ''),
    'n:' || nullif(lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g')), ''),
    'n:?'
  );
$$;

create or replace function private.intel_guard(p_household_id uuid, p_from date, p_to date)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_auth();
  if p_household_id is null or not private.is_member(p_household_id) then
    raise exception 'Família não encontrada' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.pct(p_cur numeric, p_prev numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_prev is null or p_prev = 0 or p_cur is null then null
              else round((p_cur - p_prev) / p_prev * 100, 1) end;
$$;

-- Compras confirmadas do período (filtro opcional de estabelecimento).
create or replace function private.intel_purchases(p_household_id uuid, p_from date, p_to date, p_store text)
returns table (
  purchase_id uuid, at timestamptz, local_date date, store_key text, store_name text, total numeric, bought_by uuid
)
language sql
stable
set search_path = ''
as $$
  select p.id,
         coalesce(p.purchased_at, p.confirmed_at, p.created_at),
         (coalesce(p.purchased_at, p.confirmed_at, p.created_at) at time zone 'America/Sao_Paulo')::date,
         private.store_key(p.store_cnpj, p.store_name),
         coalesce(nullif(trim(p.store_name), ''), 'Estabelecimento não identificado'),
         coalesce(p.total_amount, (select sum(i.total_price) from public.purchase_items i where i.purchase_id = p.id), 0)::numeric(12, 2),
         p.bought_by
    from public.purchases p
   where p.household_id = p_household_id
     and p.status = 'confirmed'
     and (coalesce(p.purchased_at, p.confirmed_at, p.created_at) at time zone 'America/Sao_Paulo')::date between p_from and p_to
     and (p_store is null or private.store_key(p.store_cnpj, p.store_name) = p_store);
$$;

-- Linhas de itens do período com produto, marca e categoria (filtros opcionais).
create or replace function private.intel_lines(
  p_household_id uuid, p_from date, p_to date, p_store text, p_category uuid, p_product uuid, p_brand uuid
)
returns table (
  purchase_id uuid, local_date date, store_key text, store_name text,
  item_id uuid, household_product_id uuid, product_key text, product_name text,
  brand_id uuid, brand_name text, category_id uuid, category_name text,
  quantity numeric, unit text, total_price numeric, discount numeric, unit_net numeric
)
language sql
stable
set search_path = ''
as $$
  select ip.purchase_id, ip.local_date, ip.store_key, ip.store_name,
         i.id, i.household_product_id,
         coalesce(i.household_product_id::text, 'd:' || lower(trim(i.description))),
         coalesce(pr.name, i.description),
         pr.brand_id, b.name, pr.category_id,
         coalesce(c.name, case when i.household_product_id is null then 'Não associados' else 'Sem categoria' end),
         i.quantity,
         upper(coalesce(nullif(trim(i.unit), ''), 'UN')),
         i.total_price, i.discount,
         round(i.total_price / i.quantity, 4)
    from private.intel_purchases(p_household_id, p_from, p_to, p_store) ip
    join public.purchase_items i on i.purchase_id = ip.purchase_id and not i.ignored
    left join public.household_products hp on hp.id = i.household_product_id
    left join public.products pr on pr.id = hp.product_id
    left join public.brands b on b.id = pr.brand_id
    left join public.categories c on c.id = pr.category_id
   where (p_category is null or pr.category_id = p_category)
     and (p_product is null or i.household_product_id = p_product)
     and (p_brand is null or pr.brand_id = p_brand);
$$;

-- Indicadores de um período.
create or replace function private.intel_kpis(
  p_household_id uuid, p_from date, p_to date, p_store text, p_category uuid, p_product uuid, p_brand uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with l as (select * from private.intel_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)),
       item_filter as (select (p_category is not null or p_product is not null or p_brand is not null) as on_),
       pu as (
         select * from private.intel_purchases(p_household_id, p_from, p_to, p_store)
          where not (select on_ from item_filter) or purchase_id in (select purchase_id from l)
       ),
       t as (
         select case when (select on_ from item_filter) then (select coalesce(sum(total_price), 0) from l)
                     else (select coalesce(sum(total), 0) from pu) end as total,
                (select count(*) from pu) as purchases
       )
  select jsonb_build_object(
    'total', t.total,
    'purchases', t.purchases,
    'avg_ticket', case when t.purchases > 0 then round(t.total / t.purchases, 2) end,
    'stores', (select count(distinct store_key) from pu),
    'products', (select count(distinct product_key) from l),
    'items', (select count(*) from l),
    'discount', (select coalesce(sum(discount), 0) from l)
  )
  from t;
$$;

-- Economia potencial (hipotética) por produto no período.
create or replace function private.intel_savings(
  p_household_id uuid, p_from date, p_to date, p_store text, p_category uuid, p_product uuid, p_brand uuid
)
returns table (
  household_product_id uuid, product_name text, unit text, lines int, quantity numeric,
  paid numeric, saving numeric, best_store_name text, best_price numeric
)
language sql
stable
set search_path = ''
as $$
  with l as (
    select * from private.intel_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)
     where household_product_id is not null
  ),
  obs as (
    select * from private.intel_lines(p_household_id, p_from - 90, p_to + 90, null, p_category, p_product, p_brand)
     where household_product_id is not null
  ),
  per_line as (
    select l.household_product_id, l.product_name, l.unit, l.quantity, l.total_price, l.unit_net,
           best.unit_net as best_price, best.store_name as best_store
      from l
      join lateral (
        select o.unit_net, o.store_name
          from obs o
         where o.household_product_id = l.household_product_id
           and o.unit = l.unit
           and o.store_key <> l.store_key
           and o.local_date between l.local_date - 90 and l.local_date + 90
         order by o.unit_net, o.local_date desc
         limit 1
      ) best on true
  )
  select household_product_id, min(product_name), unit, count(*)::int, sum(quantity),
         sum(total_price),
         round(sum(greatest(0, (unit_net - best_price) * quantity)), 2),
         (array_agg(best_store order by best_price))[1],
         min(best_price)
    from per_line
   group by household_product_id, unit;
$$;

-- -----------------------------------------------------------------------------
-- Opções de filtro (somente o que existe em compras confirmadas)
-- -----------------------------------------------------------------------------
create or replace function public.intel_filter_options(p_household_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_result jsonb;
begin
  perform private.intel_guard(p_household_id, v_today, v_today);
  with l as (select * from private.intel_lines(p_household_id, date '2000-01-01', v_today + 1, null, null, null, null)),
       pu as (select * from private.intel_purchases(p_household_id, date '2000-01-01', v_today + 1, null))
  select jsonb_build_object(
    'stores', coalesce((select jsonb_agg(jsonb_build_object('key', store_key, 'name', name, 'visits', visits) order by visits desc, name)
                          from (select store_key, (array_agg(store_name order by at desc))[1] as name, count(*) as visits
                                  from pu group by store_key) s), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', category_id, 'name', category_name) order by category_name)
                              from (select distinct category_id, category_name from l where category_id is not null) c), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', household_product_id, 'name', product_name) order by product_name)
                            from (select household_product_id, min(product_name) as product_name from l
                                   where household_product_id is not null group by household_product_id) p), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('id', brand_id, 'name', brand_name) order by brand_name)
                          from (select distinct brand_id, brand_name from l where brand_id is not null) b), '[]'::jsonb),
    'first_date', (select min(local_date) from pu),
    'confirmed', (select count(*) from pu),
    'drafts', (select count(*) from public.purchases where household_id = p_household_id and status = 'draft')
  ) into v_result;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Visão financeira
-- -----------------------------------------------------------------------------
create or replace function public.intel_overview(
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
  v_len    int  := p_to - p_from + 1;
  v_pfrom  date := p_from - (p_to - p_from + 1);
  v_pto    date := p_from - 1;
  v_gran   text := case when p_to - p_from + 1 <= 31 then 'day' when p_to - p_from + 1 <= 186 then 'week' else 'month' end;
  v_items  boolean := p_category is not null or p_product is not null or p_brand is not null;
  v_result jsonb;
begin
  perform private.intel_guard(p_household_id, p_from, p_to);

  with cur_l as (select * from private.intel_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)),
       prev_l as (select * from private.intel_lines(p_household_id, v_pfrom, v_pto, p_store, p_category, p_product, p_brand)),
       cur_p as (select * from private.intel_purchases(p_household_id, p_from, p_to, p_store)
                  where not v_items or purchase_id in (select purchase_id from cur_l)),
       prev_p as (select * from private.intel_purchases(p_household_id, v_pfrom, v_pto, p_store)
                   where not v_items or purchase_id in (select purchase_id from prev_l)),
       -- valor de cada compra (com filtro de item, só as linhas filtradas)
       cur_v as (
         select p.purchase_id, p.local_date, p.store_name,
                case when v_items then (select sum(total_price) from cur_l l where l.purchase_id = p.purchase_id) else p.total end as value
           from cur_p p
       ),
       prev_v as (
         select p.purchase_id, p.local_date,
                case when v_items then (select sum(total_price) from prev_l l where l.purchase_id = p.purchase_id) else p.total end as value
           from prev_p p
       ),
       cur_b as (
         select row_number() over (order by b) as n, b::date as bucket
           from generate_series(date_trunc(v_gran, p_from::timestamp), p_to::timestamp, ('1 ' || v_gran)::interval) b
       ),
       prev_b as (
         select row_number() over (order by b) as n, b::date as bucket
           from generate_series(date_trunc(v_gran, v_pfrom::timestamp), v_pto::timestamp, ('1 ' || v_gran)::interval) b
       ),
       series as (
         select cb.n, cb.bucket,
                coalesce((select sum(value) from cur_v v where date_trunc(v_gran, v.local_date::timestamp)::date = cb.bucket), 0) as total,
                (select count(*) from cur_v v where date_trunc(v_gran, v.local_date::timestamp)::date = cb.bucket) as purchases,
                (select coalesce(sum(value), 0) from prev_v v, prev_b pb
                  where pb.n = cb.n and date_trunc(v_gran, v.local_date::timestamp)::date = pb.bucket) as prev_total
           from cur_b cb
       ),
       q as (
         select percentile_cont(0.25) within group (order by value) as q1,
                percentile_cont(0.75) within group (order by value) as q3,
                count(*) as n
           from cur_v
       ),
       cats as (
         select coalesce(c.category_name, pv.category_name) as name,
                coalesce(c.total, 0) as total, coalesce(pv.total, 0) as prev_total
           from (select category_name, sum(total_price) as total from cur_l group by 1) c
           full join (select category_name, sum(total_price) as total from prev_l group by 1) pv using (category_name)
       )
  select jsonb_build_object(
    'granularity', v_gran,
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_len),
    'previous', jsonb_build_object('from', v_pfrom, 'to', v_pto),
    'kpis', private.intel_kpis(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand),
    'previous_kpis', private.intel_kpis(p_household_id, v_pfrom, v_pto, p_store, p_category, p_product, p_brand),
    'savings', (select jsonb_build_object('total', coalesce(sum(saving), 0), 'products', count(*) filter (where saving > 0))
                  from private.intel_savings(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)),
    'series', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket, 'total', total, 'purchases', purchases, 'prev_total', prev_total) order by n)
                          from series), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
                              'name', name, 'total', total, 'prev_total', prev_total,
                              'share', case when (select sum(total) from cats) > 0 then round(total / (select sum(total) from cats), 4) else 0 end,
                              'change_pct', private.pct(total, prev_total)) order by total desc)
                              from cats where total > 0 or prev_total > 0), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object(
                           'purchase_id', v.purchase_id, 'date', v.local_date, 'store_name', v.store_name, 'total', v.value,
                           'outlier', (q.n >= 4 and v.value > q.q3 + 1.5 * (q.q3 - q.q1) and v.value > 0))
                           order by v.local_date, v.purchase_id)
                           from cur_v v, q), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Supermercados: ranking, cesta comparável e economia potencial
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
  -- Preços recentes: no mínimo os últimos 90 dias até o fim do período.
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
       -- Cesta: último preço líquido de cada produto em cada mercado (todos os mercados).
       w as (
         select * from private.intel_lines(p_household_id, v_wfrom, p_to, null, p_category, p_product, p_brand)
          where household_product_id is not null
       ),
       latest as (
         select distinct on (household_product_id, unit, store_key)
                household_product_id, unit, store_key, store_name, product_name, unit_net, local_date, discount
           from w
          order by household_product_id, unit, store_key, local_date desc, unit_net
       ),
       comparable as (
         select household_product_id, unit
           from latest group by household_product_id, unit
          having count(distinct store_key) >= 2
       ),
       basket as (
         select lt.*, min(lt.unit_net) over (partition by lt.household_product_id, lt.unit) as min_price,
                max(lt.unit_net) over (partition by lt.household_product_id, lt.unit) as max_price
           from latest lt join comparable c using (household_product_id, unit)
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
                                   'household_product_id', household_product_id,
                                   'product_name', min(product_name),
                                   'unit', unit,
                                   'min_price', min(min_price),
                                   'max_price', max(max_price),
                                   'spread_pct', private.pct(max(max_price), min(min_price)),
                                   'best_store_key', (array_agg(store_key order by unit_net, local_date desc))[1],
                                   'best_store_name', (array_agg(store_name order by unit_net, local_date desc))[1],
                                   'prices', jsonb_agg(jsonb_build_object('store_key', store_key, 'store_name', store_name,
                                                                          'price', unit_net, 'date', local_date, 'discount', discount > 0)
                                                       order by unit_net)) as x
                            from basket group by household_product_id, unit) b), '[]'::jsonb),
    'savings', coalesce((select jsonb_agg(jsonb_build_object(
                           'household_product_id', household_product_id, 'product_name', product_name, 'unit', unit,
                           'lines', lines, 'quantity', quantity, 'paid', paid, 'saving', saving,
                           'best_store_name', best_store_name, 'best_price', best_price) order by saving desc)
                           from private.intel_savings(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)
                          where saving > 0), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Produtos: comprado × consumido × em estoque, frequência de reposição
-- -----------------------------------------------------------------------------
create or replace function public.intel_products(
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
  v_today  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_result jsonb;
begin
  perform private.intel_guard(p_household_id, p_from, p_to);

  with l as (select * from private.intel_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)),
       -- Histórico completo (até o fim do período) para intervalos entre compras.
       h as (select product_key, local_date from private.intel_lines(p_household_id, date '2000-01-01', p_to, null, p_category, p_product, p_brand)),
       hist as (
         select product_key, count(distinct local_date) as purchase_days,
                min(local_date) as first_date, max(local_date) as last_date
           from h group by product_key
       ),
       agg as (
         select product_key, min(household_product_id::text)::uuid as household_product_id,
                min(product_name) as product_name, min(category_name) as category_name, min(brand_name) as brand_name,
                (array_agg(unit order by local_date desc))[1] as unit,
                sum(quantity) as quantity, sum(total_price) as total,
                count(distinct purchase_id) as receipts
           from l group by product_key
       ),
       moves as (
         select household_product_id,
                sum(-quantity_delta) filter (where type = 'consumption' and quantity_delta < 0) as consumed,
                sum(-quantity_delta) filter (where type = 'inventory_adjustment' and quantity_delta < 0) as counted_down
           from public.stock_movements
          where household_id = p_household_id
            and (created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
          group by household_product_id
       ),
       tot as (select coalesce(sum(total), 0) as t from agg)
  select jsonb_build_object(
    'total', (select t from tot),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
      'key', a.product_key,
      'household_product_id', a.household_product_id,
      'product_name', a.product_name,
      'category_name', a.category_name,
      'brand_name', a.brand_name,
      'unit', a.unit,
      'quantity', a.quantity,
      'total', a.total,
      'share', case when (select t from tot) > 0 then round(a.total / (select t from tot), 4) else 0 end,
      'receipts', a.receipts,
      'purchase_days', hi.purchase_days,
      'first_date', hi.first_date,
      'last_date', hi.last_date,
      'days_since_last', v_today - hi.last_date,
      'avg_interval_days', case when hi.purchase_days >= 2
                                then round((hi.last_date - hi.first_date)::numeric / (hi.purchase_days - 1), 1) end,
      'current_qty', hp.current_qty,
      'ideal_qty', hp.ideal_qty,
      'consumed', coalesce(m.consumed, 0),
      'counted_down', coalesce(m.counted_down, 0)
    ) order by a.total desc)
    from agg a
    join hist hi on hi.product_key = a.product_key
    left join public.household_products hp on hp.id = a.household_product_id
    left join moves m on m.household_product_id = a.household_product_id), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Preços por produto (somente produtos associados = equivalentes)
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

  with l as (
         select * from private.intel_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)
          where household_product_id is not null
       ),
       prev as (
         select household_product_id, unit, sum(total_price) / nullif(sum(quantity), 0) as avg_price
           from private.intel_lines(p_household_id, v_pfrom, p_from - 1, p_store, p_category, p_product, p_brand)
          where household_product_id is not null
          group by household_product_id, unit
       ),
       ordered as (
         select l.*, row_number() over (partition by household_product_id, unit order by local_date desc, item_id) as rn_desc,
                row_number() over (partition by household_product_id, unit order by local_date, item_id) as rn_asc
           from l
       ),
       per_store as (
         select distinct on (household_product_id, unit, store_key) household_product_id, unit, store_key, store_name, unit_net
           from l order by household_product_id, unit, store_key, local_date desc
       ),
       spread as (
         select household_product_id, unit, count(*) as stores,
                min(unit_net) as store_min, max(unit_net) as store_max,
                (array_agg(store_name order by unit_net))[1] as cheapest_store
           from per_store group by household_product_id, unit
       ),
       agg as (
         select o.household_product_id, o.unit, min(o.product_name) as product_name,
                min(o.brand_name) as brand_name, min(o.category_name) as category_name,
                count(*) as observations,
                count(distinct o.local_date) as dates,
                max(o.unit_net) filter (where rn_desc = 1) as last_price,
                max(o.local_date) filter (where rn_desc = 1) as last_date,
                max(o.unit_net) filter (where rn_desc = 2) as prev_price,
                max(o.unit_net) filter (where rn_asc = 1) as first_price,
                min(o.unit_net) as min_price, max(o.unit_net) as max_price,
                round(sum(o.total_price) / nullif(sum(o.quantity), 0), 4) as avg_price
           from ordered o group by o.household_product_id, o.unit
       )
  select coalesce(jsonb_agg(jsonb_build_object(
           'household_product_id', a.household_product_id,
           'product_name', a.product_name,
           'brand_name', a.brand_name,
           'category_name', a.category_name,
           'unit', a.unit,
           'package_size', pr.package_size,
           'measure_unit', pr.unit,
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
         ) order by a.product_name), '[]'::jsonb)
    into v_result
    from agg a
    join public.household_products hp on hp.id = a.household_product_id
    join public.products pr on pr.id = hp.product_id
    left join prev pv on pv.household_product_id = a.household_product_id and pv.unit = a.unit
    left join spread s on s.household_product_id = a.household_product_id and s.unit = a.unit;
  return v_result;
end;
$$;

-- Histórico de preços de um produto (para o gráfico).
create or replace function public.intel_price_history(
  p_household_id uuid, p_household_product_id uuid, p_from date, p_to date
)
returns table (
  local_date date, store_key text, store_name text, unit text,
  quantity numeric, unit_price numeric, discount numeric, total_price numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.intel_guard(p_household_id, p_from, p_to);
  return query
    select l.local_date, l.store_key, l.store_name, l.unit, l.quantity, l.unit_net, l.discount, l.total_price
      from private.intel_lines(p_household_id, p_from, p_to, null, null, p_household_product_id, null) l
     where p_household_product_id is not null
     order by l.local_date, l.item_id;
end;
$$;

revoke execute on function private.intel_guard(uuid, date, date) from public;
revoke execute on function public.intel_filter_options(uuid) from public, anon;
revoke execute on function public.intel_overview(uuid, date, date, text, uuid, uuid, uuid) from public, anon;
revoke execute on function public.intel_stores(uuid, date, date, text, uuid, uuid, uuid) from public, anon;
revoke execute on function public.intel_products(uuid, date, date, text, uuid, uuid, uuid) from public, anon;
revoke execute on function public.intel_prices(uuid, date, date, text, uuid, uuid, uuid) from public, anon;
revoke execute on function public.intel_price_history(uuid, uuid, date, date) from public, anon;
grant execute on function public.intel_filter_options(uuid) to authenticated;
grant execute on function public.intel_overview(uuid, date, date, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.intel_stores(uuid, date, date, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.intel_products(uuid, date, date, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.intel_prices(uuid, date, date, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.intel_price_history(uuid, uuid, date, date) to authenticated;
