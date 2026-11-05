-- =============================================================================
-- Montar a lista de um jeito só (substitui a lista atual)
-- =============================================================================
-- Cada opção de "Montar a lista" limpa a lista ABERTA e monta de novo por um
-- único critério:
--   'stock'   → o que está abaixo do ideal em casa (ideal − estoque);
--   'average' → média mensal comprada nos últimos meses (opcionalmente
--               descontando o estoque).
-- Tudo numa transação. Listas finalizadas (histórico) não são tocadas.
-- =============================================================================

create or replace function public.rebuild_shopping_list(
  p_household_id uuid,
  p_mode text,
  p_months int default 3,
  p_subtract_stock boolean default false
)
returns table (list_id uuid, removed_items int, added int, months_with_data int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list_id uuid;
  v_removed int := 0;
  v_added   int := 0;
  v_months  int := 0;
begin
  perform private.require_auth();
  if not private.can_edit(p_household_id) then
    raise exception 'Você não tem permissão para editar a lista' using errcode = '42501';
  end if;
  if p_mode not in ('stock', 'average') then
    raise exception 'Modo inválido' using errcode = '22023';
  end if;

  v_list_id := public.get_or_create_open_list(p_household_id);
  perform private.require_editable_list(v_list_id);

  with del as (
    delete from public.shopping_list_items where shopping_list_items.list_id = v_list_id returning 1
  )
  select count(*) into v_removed from del;

  if p_mode = 'stock' then
    select g.added into v_added from public.generate_shopping_list(p_household_id) g;
  else
    select s.added, s.months_with_data into v_added, v_months
      from public.suggest_shopping_from_history(p_household_id, p_months, null, coalesce(p_subtract_stock, false)) s;
  end if;

  perform private.audit(p_household_id, 'shopping_list.rebuilt', 'shopping_list', v_list_id::text,
                        jsonb_build_object('mode', p_mode, 'removed', v_removed, 'added', coalesce(v_added, 0),
                                           'months', p_months, 'subtract_stock', coalesce(p_subtract_stock, false)));
  return query select v_list_id, v_removed, coalesce(v_added, 0), coalesce(v_months, 0);
end;
$$;

revoke execute on function public.rebuild_shopping_list(uuid, text, int, boolean) from public, anon;
grant execute on function public.rebuild_shopping_list(uuid, text, int, boolean) to authenticated;
