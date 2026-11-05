-- =============================================================================
-- Lista pelo consumo: média mensal do que a família compra
-- =============================================================================
-- Antes a sugestão descontava o estoque e, com o estoque já alto, quase nada
-- entrava. Agora, por padrão, cada produto comprado com frequência (média ≥ 1
-- por mês nos meses anteriores) entra na lista com a MÉDIA MENSAL comprada.
-- Descontar o que há em casa vira opção (p_subtract_stock = true).
-- Rascunhos descartados não contam. Produtos "Não envia à lista" continuam fora.
-- Itens automáticos já na lista (sem ajuste manual) sobem para a média.
-- =============================================================================

drop function if exists public.suggest_shopping_from_history(uuid, int, date);

create or replace function public.suggest_shopping_from_history(
  p_household_id uuid,
  p_months int default 3,
  p_reference date default null,
  p_subtract_stock boolean default false
)
returns table (list_id uuid, added int, months_with_data int, already_in_list int, covered_by_stock int, removed_by_user int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_auth();
  v_ref     date := date_trunc('month', coalesce(p_reference, (now() at time zone 'America/Sao_Paulo')::date))::date;
  v_from    date;
  v_list_id uuid;
  v_added   int := 0;
  v_months  int := 0;
  v_in_list int := 0;
  v_covered int := 0;
  v_removed int := 0;
begin
  if not private.can_edit(p_household_id) then
    raise exception 'Você não tem permissão para editar a lista' using errcode = '42501';
  end if;
  if p_months is null or p_months not between 1 and 12 then
    raise exception 'Período inválido (1 a 12 meses)' using errcode = '22023';
  end if;
  v_from := (v_ref - make_interval(months => p_months))::date;

  select count(distinct date_trunc('month', p.purchased_at at time zone 'America/Sao_Paulo'))
    into v_months
    from public.purchases p
   where p.household_id = p_household_id and p.status <> 'discarded'
     and (p.purchased_at at time zone 'America/Sao_Paulo')::date >= v_from
     and (p.purchased_at at time zone 'America/Sao_Paulo')::date < v_ref;

  v_list_id := public.get_or_create_open_list(p_household_id);
  perform private.require_editable_list(v_list_id);

  if v_months = 0 then
    return query select v_list_id, 0, 0, 0, 0, 0;
    return;
  end if;

  with base as (
    select i.household_product_id as id, p.purchased_at, sum(i.stock_quantity) as qty
      from public.purchase_items i
      join public.purchases p on p.id = i.purchase_id
     where p.household_id = p_household_id and p.status <> 'discarded'
       and (p.purchased_at at time zone 'America/Sao_Paulo')::date >= v_from
       and (p.purchased_at at time zone 'America/Sao_Paulo')::date < v_ref
       and i.household_product_id is not null and not i.ignored
     group by 1, 2
  ), prod as (
    select hp.id, hp.current_qty, lower(pr.name) as gname,
           coalesce(pr.brand_id, '00000000-0000-0000-0000-000000000000'::uuid) as gbrand
      from public.household_products hp
      join public.products pr on pr.id = hp.product_id
     where hp.household_id = p_household_id and hp.archived_at is null
  ), grp as (
    -- média pelo número de meses do período (mês sem compra conta como zero)
    select pr.gname, pr.gbrand, round(sum(b.qty) / p_months::numeric) as monthly
      from base b
      join prod pr on pr.id = b.id
     group by 1, 2
  ), group_stock as (
    -- estoque somando todas as variações (ex.: qualquer sabonete Farnese em casa conta)
    select gname, gbrand, sum(current_qty) as stock from prod group by 1, 2
  ), pick as (
    select distinct on (pr.gname, pr.gbrand) pr.gname, pr.gbrand, pr.id
      from base b join prod pr on pr.id = b.id
     order by pr.gname, pr.gbrand, b.purchased_at desc, b.qty desc, pr.id
  ), cand as (
    -- um candidato por produto+marca com consumo mensal ≥ 1 (compras ocasionais ficam de fora)
    select pk.id, g.monthly, gs.stock,
           exists (select 1 from public.shopping_list_items i
                    where i.list_id = v_list_id and i.household_product_id = pk.id and i.removed_at is null) as in_list,
           exists (select 1 from public.shopping_list_items i
                    where i.list_id = v_list_id and i.household_product_id = pk.id and i.removed_at is not null) as removed
      from grp g
      join group_stock gs on gs.gname = g.gname and gs.gbrand = g.gbrand
      join pick pk on pk.gname = g.gname and pk.gbrand = g.gbrand
     where g.monthly >= 1
  )
  select count(*) filter (where in_list),
         count(*) filter (where coalesce(p_subtract_stock, false) and not in_list and not removed and monthly - stock <= 0),
         count(*) filter (where removed)
    into v_in_list, v_covered, v_removed
    from cand;

  with base as (
    select i.household_product_id as id, p.purchased_at, sum(i.stock_quantity) as qty
      from public.purchase_items i
      join public.purchases p on p.id = i.purchase_id
     where p.household_id = p_household_id and p.status <> 'discarded'
       and (p.purchased_at at time zone 'America/Sao_Paulo')::date >= v_from
       and (p.purchased_at at time zone 'America/Sao_Paulo')::date < v_ref
       and i.household_product_id is not null and not i.ignored
     group by 1, 2
  ), prod as (
    select hp.id, hp.current_qty, lower(pr.name) as gname,
           coalesce(pr.brand_id, '00000000-0000-0000-0000-000000000000'::uuid) as gbrand
      from public.household_products hp
      join public.products pr on pr.id = hp.product_id
     where hp.household_id = p_household_id and hp.archived_at is null
  ), grp as (
    select pr.gname, pr.gbrand, round(sum(b.qty) / p_months::numeric) as monthly
      from base b
      join prod pr on pr.id = b.id
     group by 1, 2
  ), group_stock as (
    select gname, gbrand, sum(current_qty) as stock from prod group by 1, 2
  ), pick as (
    select distinct on (pr.gname, pr.gbrand) pr.gname, pr.gbrand, pr.id
      from base b join prod pr on pr.id = b.id
     order by pr.gname, pr.gbrand, b.purchased_at desc, b.qty desc, pr.id
  ), need as (
    select pk.id,
           case when coalesce(p_subtract_stock, false) then g.monthly - gs.stock else g.monthly end as qty
      from grp g
      join group_stock gs on gs.gname = g.gname and gs.gbrand = g.gbrand
      join pick pk on pk.gname = g.gname and pk.gbrand = g.gbrand
     where g.monthly >= 1
       and (not coalesce(p_subtract_stock, false) or g.monthly - gs.stock > 0)
  ), upd as (
    -- item que já está na lista (automático, sem ajuste manual): sobe para a média
    update public.shopping_list_items i
       set quantity = n.qty
      from need n
     where i.list_id = v_list_id and i.household_product_id = n.id
       and i.removed_at is null and i.checked_at is null and not i.manually_edited
       and i.origin in ('stock', 'suggestion') and i.quantity < n.qty
    returning 1
  ), ins as (
    insert into public.shopping_list_items (list_id, household_id, household_product_id, quantity, origin, created_by)
    select v_list_id, p_household_id, n.id, n.qty, 'suggestion', v_uid
      from need n
     where not exists (
       select 1 from public.shopping_list_items i
        where i.list_id = v_list_id and i.household_product_id = n.id
     )
    on conflict do nothing
    returning 1
  )
  select count(*) into v_added from ins;

  update public.shopping_lists set updated_at = now() where id = v_list_id;
  perform private.audit(p_household_id, 'shopping_list.suggested', 'shopping_list', v_list_id::text,
                        jsonb_build_object('added', v_added, 'months', p_months, 'reference', v_ref));
  return query select v_list_id, v_added, v_months, v_in_list, v_covered, v_removed;
end;
$$;

revoke execute on function public.suggest_shopping_from_history(uuid, int, date, boolean) from public, anon;
grant execute on function public.suggest_shopping_from_history(uuid, int, date, boolean) to authenticated;
