-- =============================================================================
-- Recomeçar a lista de compras
-- =============================================================================
-- Limpa a lista ABERTA (itens, ajustes manuais, marcações e remoções) e monta de
-- novo: primeiro pelo estoque (quanto manter − em casa), depois completa com a
-- sugestão pelo consumo dos últimos meses. Listas finalizadas (histórico) não
-- são tocadas. Tudo numa transação: ou recomeça inteiro, ou nada muda.
-- =============================================================================

create or replace function public.reset_shopping_list(p_household_id uuid, p_months int default 3)
returns table (list_id uuid, removed_items int, added_from_stock int, added_from_history int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list_id uuid;
  v_removed int := 0;
  v_stock   int := 0;
  v_hist    int := 0;
begin
  perform private.require_auth();
  if not private.can_edit(p_household_id) then
    raise exception 'Você não tem permissão para editar a lista' using errcode = '42501';
  end if;

  v_list_id := public.get_or_create_open_list(p_household_id);
  perform private.require_editable_list(v_list_id);

  with del as (
    delete from public.shopping_list_items where shopping_list_items.list_id = v_list_id returning 1
  )
  select count(*) into v_removed from del;

  select g.added into v_stock from public.generate_shopping_list(p_household_id) g;
  select s.added into v_hist from public.suggest_shopping_from_history(p_household_id, p_months) s;

  perform private.audit(p_household_id, 'shopping_list.reset', 'shopping_list', v_list_id::text,
                        jsonb_build_object('removed', v_removed, 'from_stock', v_stock, 'from_history', v_hist));
  return query select v_list_id, v_removed, coalesce(v_stock, 0), coalesce(v_hist, 0);
end;
$$;

revoke execute on function public.reset_shopping_list(uuid, int) from public, anon;
grant execute on function public.reset_shopping_list(uuid, int) to authenticated;
