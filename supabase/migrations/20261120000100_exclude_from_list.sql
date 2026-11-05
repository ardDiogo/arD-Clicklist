-- =============================================================================
-- Produto "Não envia à lista"
-- =============================================================================
-- Produtos marcados (ex.: marmitex, comida pronta) nunca entram AUTOMATICAMENTE
-- na lista de compras: nem pelo estoque, nem pelo histórico de consumo, nem pelo
-- "Recomeçar lista". O usuário ainda pode adicioná-los à mão. Também não contam
-- como "para repor"/"em falta". Compras e gastos continuam registrados normalmente.
-- =============================================================================

alter table public.household_products
  add column if not exists exclude_from_list boolean not null default false;

-- Bloqueia inclusões automáticas (origem estoque ou sugestão) desses produtos.
create or replace function private.skip_excluded_list_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_product_id is not null
     and new.origin in ('stock', 'suggestion')
     and exists (select 1 from public.household_products hp
                  where hp.id = new.household_product_id and hp.exclude_from_list) then
    return null; -- ignora a linha em silêncio
  end if;
  return new;
end;
$$;

drop trigger if exists shopping_list_items_skip_excluded on public.shopping_list_items;
create trigger shopping_list_items_skip_excluded before insert on public.shopping_list_items
  for each row execute function private.skip_excluded_list_items();

-- Status de reposição: produto marcado fica como "sem controle" (não pede reposição).
create or replace view public.household_stock
with (security_invoker = true)
as
select
  hp.id,
  hp.household_id,
  hp.product_id,
  p.name             as product_name,
  p.presentation,
  p.package_size,
  p.unit,
  p.barcode,
  b.id               as brand_id,
  b.name             as brand_name,
  c.id               as category_id,
  c.name             as category_name,
  c.sort_order       as category_sort,
  l.id               as location_id,
  l.name             as location_name,
  l.sort_order       as location_sort,
  hp.ideal_qty,
  hp.current_qty,
  case when hp.exclude_from_list then 0 else greatest(0, hp.ideal_qty - hp.current_qty) end as to_buy_qty,
  case
    when hp.exclude_from_list or hp.ideal_qty = 0 then 'untracked'
    when hp.current_qty = 0 then 'out'
    when hp.current_qty < hp.ideal_qty then 'low'
    else 'ok'
  end                as status,
  hp.notes,
  hp.last_movement_at,
  hp.created_at,
  hp.updated_at,
  hp.exclude_from_list
from public.household_products hp
join public.products p on p.id = hp.product_id
left join public.brands b on b.id = p.brand_id
left join public.categories c on c.id = p.category_id
left join public.locations l on l.id = hp.location_id
where hp.archived_at is null;

grant select on public.household_stock to authenticated;

-- Marca/desmarca. Ao marcar, tira da lista aberta os itens que entraram sozinhos
-- (os adicionados à mão ou já marcados no carrinho ficam).
create or replace function public.set_product_list_exclusion(p_household_product_id uuid, p_exclude boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hp      public.household_products%rowtype;
  v_removed int := 0;
begin
  perform private.require_auth();
  select * into v_hp from public.household_products where id = p_household_product_id and archived_at is null;
  if not found or not private.can_edit(v_hp.household_id) then
    raise exception 'Produto não encontrado' using errcode = 'P0002';
  end if;

  update public.household_products set exclude_from_list = coalesce(p_exclude, false) where id = p_household_product_id;

  if coalesce(p_exclude, false) then
    with del as (
      delete from public.shopping_list_items i
       using public.shopping_lists l
       where l.id = i.list_id and l.status = 'open'
         and i.household_product_id = p_household_product_id
         and i.origin in ('stock', 'suggestion')
         and not i.manually_edited
         and i.checked_at is null
      returning 1
    )
    select count(*) into v_removed from del;
  end if;

  perform private.audit(v_hp.household_id, 'product.list_exclusion', 'household_product', p_household_product_id::text,
                        jsonb_build_object('exclude', coalesce(p_exclude, false), 'removed_from_list', v_removed));
  return v_removed;
end;
$$;

revoke execute on function public.set_product_list_exclusion(uuid, boolean) from public, anon;
grant execute on function public.set_product_list_exclusion(uuid, boolean) to authenticated;
