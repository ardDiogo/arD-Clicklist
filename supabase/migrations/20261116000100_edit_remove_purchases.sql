-- =============================================================================
-- Editar ou remover uma compra já confirmada
-- =============================================================================
-- Princípios mantidos:
--   * O histórico de movimentações nunca é apagado: o que a compra lançou no
--     estoque é ESTORNADO por novas movimentações (correção com origem na compra).
--   * O estoque nunca fica negativo: se parte já foi consumida, estorna só o que
--     ainda existe (e registra isso na observação).
--   * Remover = estorna o estoque e marca a compra como descartada (sai do
--     histórico de preços e do Financeiro, mas o registro continua no banco).
--   * Editar = estorna o estoque e reabre a compra como rascunho (revision + 1);
--     ao confirmar de novo, os lançamentos usam chaves novas de idempotência.
-- Rascunhos ganham edição de itens: descrição, quantidade, valor, excluir e incluir.
-- =============================================================================

alter table public.purchases add column if not exists revision int not null default 0;

-- Estorna tudo o que a compra ainda tem lançado no estoque (líquido por produto).
create or replace function private.revert_purchase_stock(p_purchase_id uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.purchases%rowtype;
  v_row   record;
  v_qty   numeric;
  v_count int := 0;
begin
  select * into v_p from public.purchases where id = p_purchase_id;
  for v_row in
    select m.household_product_id as hp, sum(m.quantity_delta) as net, max(hp.current_qty) as current_qty
      from public.stock_movements m
      join public.household_products hp on hp.id = m.household_product_id
     where m.household_id = v_p.household_id and m.source = 'purchase' and m.source_id = p_purchase_id
     group by m.household_product_id
    having sum(m.quantity_delta) > 0
  loop
    v_qty := least(v_row.net, v_row.current_qty);
    if v_qty > 0 then
      perform private.apply_stock_movement(
        v_row.hp, 'correction', -v_qty, 'purchase', p_purchase_id,
        left(p_reason || case when v_qty < v_row.net
                             then ' (parte já tinha sido consumida: estornado ' || trim_scale(v_qty)::text
                                  || ' de ' || trim_scale(v_row.net)::text || ')' else '' end, 500),
        'purchase-revert:' || p_purchase_id::text || ':r' || v_p.revision::text || ':' || v_row.hp::text);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Reabre uma compra confirmada para edição.
create or replace function public.reopen_purchase(p_purchase_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.purchases%rowtype;
  v_count int;
begin
  perform private.require_auth();
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found or not private.can_edit(v_p.household_id) then
    raise exception 'Compra não encontrada' using errcode = 'P0002';
  end if;
  if v_p.status = 'draft' then
    return 0; -- já está em edição (idempotente)
  end if;
  if v_p.status <> 'confirmed' then
    raise exception 'Esta compra foi removida' using errcode = '22023';
  end if;

  v_count := private.revert_purchase_stock(p_purchase_id, 'Estorno: compra reaberta para edição');
  update public.purchase_items set unit_cost = null where purchase_id = p_purchase_id;
  update public.purchases
     set status = 'draft', confirmed_at = null, confirmed_by = null, revision = revision + 1
   where id = p_purchase_id;

  perform private.audit(v_p.household_id, 'purchase.reopened', 'purchase', p_purchase_id::text,
                        jsonb_build_object('reverted_products', v_count));
  return v_count;
end;
$$;

-- Remove uma compra (rascunho ou confirmada). Confirmada: estorna o estoque antes.
create or replace function public.remove_purchase(p_purchase_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.purchases%rowtype;
  v_count int := 0;
begin
  perform private.require_auth();
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found or not private.can_edit(v_p.household_id) then
    raise exception 'Compra não encontrada' using errcode = 'P0002';
  end if;
  if v_p.status = 'discarded' then
    return 0; -- idempotente
  end if;
  if v_p.status = 'confirmed' then
    v_count := private.revert_purchase_stock(p_purchase_id, 'Estorno: compra removida');
  end if;
  update public.purchases set status = 'discarded' where id = p_purchase_id;
  perform private.audit(v_p.household_id, 'purchase.removed', 'purchase', p_purchase_id::text,
                        jsonb_build_object('was', v_p.status, 'reverted_products', v_count));
  return v_count;
end;
$$;

-- Edição dos itens (somente rascunho) -----------------------------------------
create or replace function public.update_purchase_item_values(
  p_item_id uuid,
  p_description text,
  p_quantity numeric,
  p_total_price numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.purchase_items%rowtype;
begin
  select * into v_item from public.purchase_items where id = p_item_id;
  if not found then
    raise exception 'Item não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_draft_purchase(v_item.purchase_id);
  if p_description is null or char_length(trim(p_description)) not between 1 and 200 then
    raise exception 'Informe a descrição do item' using errcode = '22023';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'A quantidade deve ser maior que zero' using errcode = '22023';
  end if;
  if p_total_price is null or p_total_price < 0 then
    raise exception 'Valor inválido' using errcode = '22023';
  end if;
  update public.purchase_items
     set description = trim(p_description),
         quantity = p_quantity,
         total_price = round(p_total_price, 2),
         unit_price = round((p_total_price + discount) / p_quantity, 4),
         stock_quantity = case when quantity <> p_quantity and coalesce(unit, 'UN') not in ('KG', 'G', 'GR', 'L', 'ML', 'LT')
                               then greatest(1, round(p_quantity)) else stock_quantity end
   where id = p_item_id;
end;
$$;

create or replace function public.delete_purchase_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.purchase_items%rowtype;
begin
  select * into v_item from public.purchase_items where id = p_item_id;
  if not found then
    raise exception 'Item não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_draft_purchase(v_item.purchase_id);
  delete from public.purchase_items where id = p_item_id;
end;
$$;

create or replace function public.add_purchase_item(
  p_purchase_id uuid,
  p_description text,
  p_quantity numeric,
  p_total_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p  public.purchases%rowtype;
  v_id uuid;
begin
  v_p := private.require_draft_purchase(p_purchase_id);
  if p_description is null or char_length(trim(p_description)) not between 1 and 200 then
    raise exception 'Informe a descrição do item' using errcode = '22023';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'A quantidade deve ser maior que zero' using errcode = '22023';
  end if;
  if p_total_price is null or p_total_price < 0 then
    raise exception 'Valor inválido' using errcode = '22023';
  end if;
  insert into public.purchase_items (
    purchase_id, household_id, line_number, description, quantity, unit, unit_price, total_price, stock_quantity
  ) values (
    p_purchase_id, v_p.household_id,
    coalesce((select max(line_number) from public.purchase_items where purchase_id = p_purchase_id), 0) + 1,
    trim(p_description), p_quantity, 'UN', round(p_total_price / p_quantity, 4), round(p_total_price, 2),
    greatest(1, round(p_quantity))
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Data e mercado também editáveis no rascunho (função já existia; mantém).

revoke execute on function private.revert_purchase_stock(uuid, text) from public, anon, authenticated;

revoke execute on function
  public.reopen_purchase(uuid),
  public.remove_purchase(uuid),
  public.update_purchase_item_values(uuid, text, numeric, numeric),
  public.delete_purchase_item(uuid),
  public.add_purchase_item(uuid, text, numeric, numeric)
from public, anon;

grant execute on function
  public.reopen_purchase(uuid),
  public.remove_purchase(uuid),
  public.update_purchase_item_values(uuid, text, numeric, numeric),
  public.delete_purchase_item(uuid),
  public.add_purchase_item(uuid, text, numeric, numeric)
to authenticated;

-- confirm_purchase: igual à versão anterior, com chave de idempotência por revisão
-- (para que uma compra reaberta e confirmada de novo lance o estoque outra vez).
create or replace function public.confirm_purchase(p_purchase_id uuid)
returns table (applied_items int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_auth();
  v_p     public.purchases%rowtype;
  v_item  public.purchase_items%rowtype;
  v_count int := 0;
  v_key   text;
begin
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found or not private.can_edit(v_p.household_id) then
    raise exception 'Compra não encontrada' using errcode = 'P0002';
  end if;
  if v_p.status = 'confirmed' then
    return query select 0; -- idempotente
    return;
  end if;
  if v_p.status <> 'draft' then
    raise exception 'Esta compra foi descartada' using errcode = '22023';
  end if;

  -- Itens sem produto (e não ignorados) viram produtos novos no cadastro.
  perform private.auto_create_purchase_products(p_purchase_id);

  for v_item in
    select * from public.purchase_items where purchase_id = p_purchase_id order by line_number for update
  loop
    if v_item.household_product_id is null or v_item.ignored then
      continue;
    end if;

    -- Custo por embalagem de estoque (para o histórico e para a próxima lista).
    update public.purchase_items
       set unit_cost = case when v_item.stock_quantity > 0
                            then round(v_item.total_price / v_item.stock_quantity, 4)
                            else round(v_item.total_price / v_item.quantity, 4) end
     where id = v_item.id;

    if v_item.received and v_item.stock_quantity > 0 then
      perform private.apply_stock_movement(
        v_item.household_product_id, 'purchase', v_item.stock_quantity, 'purchase', p_purchase_id,
        left('Compra: ' || coalesce(v_p.store_name, 'comprovante'), 500), 'purchase-item:' || v_item.id::text
          || case when v_p.revision > 0 then ':r' || v_p.revision::text else '' end);
      v_count := v_count + 1;
    end if;

    -- Aprendizado: EAN e descrição do cupom passam a apontar para este produto.
    if v_item.ean is not null then
      insert into public.product_aliases (household_id, household_product_id, kind, key, store_cnpj)
      values (v_p.household_id, v_item.household_product_id, 'ean', v_item.ean, '')
      on conflict (household_id, kind, key, store_cnpj)
      do update set household_product_id = excluded.household_product_id,
                    times_used = public.product_aliases.times_used + 1;
    end if;
    v_key := private.normalize_text(v_item.description);
    if v_key is not null then
      insert into public.product_aliases (household_id, household_product_id, kind, key, store_cnpj)
      values (v_p.household_id, v_item.household_product_id, 'description', left(v_key, 200), coalesce(v_p.store_cnpj, ''))
      on conflict (household_id, kind, key, store_cnpj)
      do update set household_product_id = excluded.household_product_id,
                    times_used = public.product_aliases.times_used + 1;
    end if;
  end loop;

  update public.purchases
     set status = 'confirmed', confirmed_at = now(), confirmed_by = v_uid
   where id = p_purchase_id;

  -- A lista aberta "se marca sozinha" com o que foi comprado e completa preços vazios.
  update public.shopping_list_items i
     set checked_at = now(), checked_by = v_uid
    from public.shopping_lists sl
   where sl.id = i.list_id and sl.household_id = v_p.household_id and sl.status = 'open'
     and i.checked_at is null and i.removed_at is null
     and i.household_product_id in (
       select household_product_id from public.purchase_items
        where purchase_id = p_purchase_id and received and not ignored and household_product_id is not null);

  update public.shopping_list_items i
     set estimated_unit_price = private.last_unit_cost(i.household_product_id)
    from public.shopping_lists sl
   where sl.id = i.list_id and sl.household_id = v_p.household_id and sl.status = 'open'
     and i.estimated_unit_price is null and i.household_product_id is not null;

  perform private.audit(v_p.household_id, 'purchase.confirmed', 'purchase', p_purchase_id::text,
                        jsonb_build_object('applied_items', v_count));
  return query select v_count;
end;
$$;
