-- =============================================================================
-- Remover lista de compras finalizada
-- =============================================================================
-- Apaga uma lista finalizada (ou cancelada) do histórico. Se ela lançou itens no
-- estoque ao ser finalizada, pode desfazer esse lançamento (recomendado quando o
-- cupom da mesma compra também foi registrado, para não contar duas vezes).
-- O estorno nunca deixa o estoque negativo e fica registrado no histórico de
-- movimentações. A lista aberta não pode ser removida (use "Recomeçar lista").
-- =============================================================================

create or replace function public.remove_shopping_list(p_list_id uuid, p_revert_stock boolean default true)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list  public.shopping_lists%rowtype;
  v_row   record;
  v_qty   numeric;
  v_count int := 0;
begin
  perform private.require_auth();
  select * into v_list from public.shopping_lists where id = p_list_id for update;
  if not found or not private.can_edit(v_list.household_id) then
    raise exception 'Lista não encontrada' using errcode = 'P0002';
  end if;
  if v_list.status = 'open' then
    raise exception 'A lista atual não pode ser removida. Use "Recomeçar lista" para limpá-la.' using errcode = '22023';
  end if;

  if coalesce(p_revert_stock, true) and v_list.stock_applied_at is not null then
    for v_row in
      select m.household_product_id as hp, sum(m.quantity_delta) as net, max(hp.current_qty) as current_qty
        from public.stock_movements m
        join public.household_products hp on hp.id = m.household_product_id
       where m.household_id = v_list.household_id and m.source = 'purchase' and m.source_id = p_list_id
       group by m.household_product_id
      having sum(m.quantity_delta) > 0
    loop
      v_qty := least(v_row.net, v_row.current_qty);
      if v_qty > 0 then
        perform private.apply_stock_movement(
          v_row.hp, 'correction', -v_qty, 'purchase', p_list_id,
          left('Lista de compras removida' || case when v_qty < v_row.net
                 then ' (parte já tinha sido consumida: estornado ' || trim_scale(v_qty)::text
                      || ' de ' || trim_scale(v_row.net)::text || ')' else '' end, 500),
          'list-revert:' || p_list_id::text || ':' || v_row.hp::text);
        v_count := v_count + 1;
      end if;
    end loop;
  end if;

  delete from public.shopping_lists where id = p_list_id;

  perform private.audit(v_list.household_id, 'shopping_list.removed', 'shopping_list', p_list_id::text,
                        jsonb_build_object('reverted_items', v_count,
                                           'had_stock', v_list.stock_applied_at is not null,
                                           'revert_stock', coalesce(p_revert_stock, true)));
  return v_count;
end;
$$;

revoke execute on function public.remove_shopping_list(uuid, boolean) from public, anon;
grant execute on function public.remove_shopping_list(uuid, boolean) to authenticated;
