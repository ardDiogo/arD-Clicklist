-- =============================================================================
-- Sugestão de compras pelo histórico de consumo
-- =============================================================================
-- Premissa (validada com a família): cada compra repõe o que foi consumido desde a
-- anterior. Então a média mensal comprada nos últimos N meses ≈ consumo mensal.
--
-- suggest_shopping_from_history:
--   * considera compras não descartadas dos N meses ANTERIORES ao mês de referência;
--   * soma por produto + marca (variações de sabor/fragrância contam juntas) e
--     atribui a sugestão à variação comprada mais recentemente;
--   * sugere  arredondar(média mensal) − estoque atual  (só se > 0);
--   * adiciona na lista aberta com origem 'suggestion', sem duplicar, sem mexer em
--     itens já presentes e sem trazer de volta itens removidos pelo usuário.
-- =============================================================================

create or replace function public.suggest_shopping_from_history(
  p_household_id uuid,
  p_months int default 3,
  p_reference date default null
)
returns table (list_id uuid, added int, months_with_data int)
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
    return query select v_list_id, 0, 0;
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
  ), need as (
    select pk.id, g.monthly - gs.stock as qty
      from grp g
      join group_stock gs on gs.gname = g.gname and gs.gbrand = g.gbrand
      join pick pk on pk.gname = g.gname and pk.gbrand = g.gbrand
     where g.monthly - gs.stock > 0
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
  return query select v_list_id, v_added, v_months;
end;
$$;

revoke execute on function public.suggest_shopping_from_history(uuid, int, date) from public, anon;
grant execute on function public.suggest_shopping_from_history(uuid, int, date) to authenticated;
