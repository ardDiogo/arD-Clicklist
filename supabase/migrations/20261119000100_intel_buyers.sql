-- =============================================================================
-- Inteligência de compras: estatísticas por comprador (quem fez a compra)
-- =============================================================================
-- Usa purchases.bought_by (migration 20261117) e as funções auxiliares da
-- 20261118. Respeita os mesmos filtros; com filtro de categoria/produto/marca,
-- soma só as linhas filtradas. Compras sem comprador aparecem como "Não informado".

create or replace function public.intel_buyers(
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
  v_pfrom  date := p_from - (p_to - p_from + 1);
  v_result jsonb;
begin
  perform private.intel_guard(p_household_id, p_from, p_to);

  with cur_l as (select * from private.intel_lines(p_household_id, p_from, p_to, p_store, p_category, p_product, p_brand)),
       prev_l as (select * from private.intel_lines(p_household_id, v_pfrom, p_from - 1, p_store, p_category, p_product, p_brand)),
       cur as (
         select p.*, case when v_items then (select sum(total_price) from cur_l l where l.purchase_id = p.purchase_id) else p.total end as value
           from private.intel_purchases(p_household_id, p_from, p_to, p_store) p
          where not v_items or p.purchase_id in (select purchase_id from cur_l)
       ),
       prev as (
         select p.bought_by, case when v_items then (select sum(total_price) from prev_l l where l.purchase_id = p.purchase_id) else p.total end as value
           from private.intel_purchases(p_household_id, v_pfrom, p_from - 1, p_store) p
          where not v_items or p.purchase_id in (select purchase_id from prev_l)
       ),
       agg as (
         select bought_by, count(*) as purchases, sum(value) as total, round(avg(value), 2) as avg_ticket,
                max(local_date) as last_date,
                count(distinct store_key) as stores,
                mode() within group (order by store_name) as top_store
           from cur group by bought_by
       ),
       prev_agg as (select bought_by, sum(value) as total from prev group by bought_by),
       items as (
         select p.bought_by, count(*) as lines, count(distinct l.product_key) as products
           from cur_l l join cur p on p.purchase_id = l.purchase_id
          group by p.bought_by
       ),
       tot as (select coalesce(sum(total), 0) as t from agg)
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', a.bought_by,
           'name', case when a.bought_by is null then 'Não informado'
                        else coalesce(pf.full_name,
                                      case when exists (select 1 from public.household_members m
                                                         where m.household_id = p_household_id and m.user_id = a.bought_by)
                                           then 'Membro sem nome' else 'Ex-membro' end) end,
           'purchases', a.purchases,
           'total', a.total,
           'avg_ticket', a.avg_ticket,
           'share', case when (select t from tot) > 0 then round(a.total / (select t from tot), 4) else 0 end,
           'prev_total', coalesce(pa.total, 0),
           'change_pct', private.pct(a.total, pa.total),
           'last_date', a.last_date,
           'stores', a.stores,
           'top_store', a.top_store,
           'products', coalesce(i.products, 0),
           'lines', coalesce(i.lines, 0)
         ) order by a.total desc), '[]'::jsonb)
    into v_result
    from agg a
    left join public.profiles pf on pf.id = a.bought_by
    left join prev_agg pa on pa.bought_by is not distinct from a.bought_by
    left join items i on i.bought_by is not distinct from a.bought_by;
  return v_result;
end;
$$;

revoke execute on function public.intel_buyers(uuid, date, date, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.intel_buyers(uuid, date, date, text, uuid, uuid, uuid) to authenticated;
