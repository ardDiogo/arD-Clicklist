-- =============================================================================
-- FASE 6 — Painel financeiro
-- =============================================================================
-- Somente leitura, baseado em dados reais: compras CONFIRMADAS (Fase 4).
-- Todas as views usam security_invoker, então o RLS de quem consulta se aplica
-- (cada família só enxerga os próprios números). Meses no fuso de Brasília.
-- =============================================================================

-- Total de cada compra confirmada. Usa o total do cupom; se ausente, a soma dos itens.
create view public.purchase_totals
with (security_invoker = true)
as
select
  p.id,
  p.household_id,
  coalesce(p.purchased_at, p.confirmed_at)                                              as purchased_at,
  date_trunc('month', coalesce(p.purchased_at, p.confirmed_at) at time zone 'America/Sao_Paulo')::date as month,
  coalesce(nullif(trim(p.store_name), ''), 'Estabelecimento não identificado')         as store_name,
  p.store_cnpj,
  p.source,
  coalesce(p.total_amount, (select sum(i.total_price) from public.purchase_items i where i.purchase_id = p.id), 0)::numeric(12, 2) as total,
  (select count(*) from public.purchase_items i where i.purchase_id = p.id and not i.ignored)::int as item_count
from public.purchases p
where p.status = 'confirmed';

grant select on public.purchase_totals to authenticated;

-- Gasto por mês.
create view public.monthly_spending
with (security_invoker = true)
as
select
  household_id,
  month,
  sum(total)::numeric(12, 2)          as total,
  count(*)::int                       as purchases,
  round(avg(total), 2)::numeric(12, 2) as avg_ticket
from public.purchase_totals
group by household_id, month;

grant select on public.monthly_spending to authenticated;

-- Gasto por categoria e mês (soma dos itens; itens sem produto vão para "Sem categoria").
create view public.category_spending
with (security_invoker = true)
as
select
  i.household_id,
  date_trunc('month', coalesce(p.purchased_at, p.confirmed_at) at time zone 'America/Sao_Paulo')::date as month,
  coalesce(c.name, case when i.household_product_id is null then 'Não associados' else 'Sem categoria' end) as category_name,
  coalesce(c.sort_order, 9999)            as category_sort,
  sum(i.total_price)::numeric(12, 2)      as total,
  count(*)::int                           as items
from public.purchase_items i
join public.purchases p on p.id = i.purchase_id and p.status = 'confirmed'
left join public.household_products hp on hp.id = i.household_product_id
left join public.products pr on pr.id = hp.product_id
left join public.categories c on c.id = pr.category_id
where not i.ignored
group by i.household_id, 2, 3, 4;

grant select on public.category_spending to authenticated;

-- Histórico por estabelecimento.
create view public.store_spending
with (security_invoker = true)
as
select
  household_id,
  coalesce(store_cnpj, store_name)     as store_key,
  (array_agg(store_name order by purchased_at desc))[1] as store_name,
  count(*)::int                        as visits,
  sum(total)::numeric(12, 2)           as total,
  round(avg(total), 2)::numeric(12, 2) as avg_ticket,
  max(purchased_at)                    as last_visit
from public.purchase_totals
group by household_id, coalesce(store_cnpj, store_name);

grant select on public.store_spending to authenticated;

-- Variação de preço por produto (último pago vs. anterior), já com nome do produto.
create view public.price_changes
with (security_invoker = true)
as
select
  pp.household_product_id,
  pp.household_id,
  s.product_name,
  s.brand_name,
  s.presentation,
  s.package_size,
  s.unit,
  pp.last_price,
  pp.previous_price,
  pp.min_price,
  pp.max_price,
  pp.avg_price,
  pp.purchases,
  pp.last_purchased_at,
  case when pp.previous_price > 0
       then round((pp.last_price - pp.previous_price) / pp.previous_price * 100, 1) end as variation_pct
from public.household_product_prices pp
join public.household_stock s on s.id = pp.household_product_id;

grant select on public.price_changes to authenticated;
