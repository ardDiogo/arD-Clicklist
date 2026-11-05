-- =============================================================================
-- Editar o nome do estabelecimento de uma compra (também em compras confirmadas)
-- =============================================================================
-- O nome do mercado é só identificação: pode ser corrigido a qualquer momento sem
-- mexer em valores, itens ou estoque. Opcionalmente aplica a todas as compras da
-- família que têm o mesmo nome antigo (ex.: "ARAGUARI - 221" → "Mart Minas Araguari").
-- =============================================================================

create or replace function public.rename_purchase_store(
  p_purchase_id uuid,
  p_store_name text,
  p_apply_to_same_name boolean default true
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.purchases%rowtype;
  v_name  text := nullif(left(trim(p_store_name), 160), '');
  v_count int;
begin
  perform private.require_auth();
  select * into v_p from public.purchases where id = p_purchase_id;
  if not found or not private.can_edit(v_p.household_id) or v_p.status = 'discarded' then
    raise exception 'Compra não encontrada' using errcode = 'P0002';
  end if;
  if v_name is null then
    raise exception 'Informe o nome do estabelecimento' using errcode = '22023';
  end if;

  with upd as (
    update public.purchases
       set store_name = v_name
     where household_id = v_p.household_id
       and status <> 'discarded'
       and (id = p_purchase_id
            or (p_apply_to_same_name and v_p.store_name is not null
                and lower(trim(store_name)) = lower(trim(v_p.store_name))))
    returning 1
  )
  select count(*) into v_count from upd;

  perform private.audit(v_p.household_id, 'purchase.store_renamed', 'purchase', p_purchase_id::text,
                        jsonb_build_object('from', v_p.store_name, 'to', v_name, 'purchases', v_count));
  return v_count;
end;
$$;

revoke execute on function public.rename_purchase_store(uuid, text, boolean) from public, anon;
grant execute on function public.rename_purchase_store(uuid, text, boolean) to authenticated;
