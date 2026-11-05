-- =============================================================================
-- FASE 3 — Lista de compras inteligente
-- =============================================================================
-- Regras:
--   * Cada família tem no máximo UMA lista aberta por vez.
--   * A geração automática usa household_stock.to_buy_qty (ideal − atual).
--   * Um produto aparece no máximo uma vez por lista (sem duplicar).
--   * Itens editados ou incluídos manualmente nunca são sobrescritos pela geração.
--   * Itens removidos pelo usuário ficam marcados (removed_at) e não voltam
--     sozinhos numa nova geração da mesma lista.
--   * Finalizar a lista pode lançar os itens marcados no estoque como compra,
--     somente com confirmação explícita, de forma idempotente.
-- =============================================================================

create type public.shopping_list_status as enum ('open', 'completed', 'cancelled');
create type public.shopping_item_origin as enum ('manual', 'stock', 'suggestion');

create table public.shopping_lists (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  name             text not null default 'Lista de compras' check (char_length(trim(name)) between 1 and 80),
  status           public.shopping_list_status not null default 'open',
  stock_applied_at timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  completed_by     uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create unique index shopping_lists_one_open on public.shopping_lists (household_id) where status = 'open';
create index shopping_lists_household_idx on public.shopping_lists (household_id, created_at desc);

create trigger shopping_lists_updated_at before update on public.shopping_lists
  for each row execute function private.set_updated_at();
create trigger shopping_lists_immutable_household before update on public.shopping_lists
  for each row execute function private.prevent_household_change();

create table public.shopping_list_items (
  id                    uuid primary key default gen_random_uuid(),
  list_id               uuid not null references public.shopping_lists (id) on delete cascade,
  household_id          uuid not null references public.households (id) on delete cascade,
  household_product_id  uuid references public.household_products (id) on delete set null,
  custom_name           text check (custom_name is null or char_length(trim(custom_name)) between 1 and 120),
  quantity              numeric(12, 3) not null check (quantity > 0),
  origin                public.shopping_item_origin not null,
  manually_edited       boolean not null default false,
  estimated_unit_price  numeric(12, 2) check (estimated_unit_price is null or estimated_unit_price >= 0),
  notes                 text check (notes is null or char_length(notes) <= 300),
  checked_at            timestamptz,
  checked_by            uuid references auth.users (id) on delete set null,
  removed_at            timestamptz,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint shopping_list_items_what check (household_product_id is not null or custom_name is not null)
);

-- Sem duplicidade: um produto (ou um item livre com o mesmo nome) por lista.
create unique index shopping_list_items_unique_product
  on public.shopping_list_items (list_id, household_product_id) where household_product_id is not null;
create unique index shopping_list_items_unique_custom
  on public.shopping_list_items (list_id, lower(trim(custom_name))) where household_product_id is null;
create index shopping_list_items_list_idx on public.shopping_list_items (list_id);

create trigger shopping_list_items_updated_at before update on public.shopping_list_items
  for each row execute function private.set_updated_at();
create trigger shopping_list_items_immutable_household before update on public.shopping_list_items
  for each row execute function private.prevent_household_change();

-- -----------------------------------------------------------------------------
-- RLS: leitura para membros; toda escrita via RPC.
-- -----------------------------------------------------------------------------
alter table public.shopping_lists      enable row level security;
alter table public.shopping_list_items enable row level security;

create policy shopping_lists_select on public.shopping_lists for select to authenticated
  using (private.is_member(household_id));
create policy shopping_list_items_select on public.shopping_list_items for select to authenticated
  using (private.is_member(household_id));

revoke all on public.shopping_lists, public.shopping_list_items from anon, authenticated;
grant select on public.shopping_lists, public.shopping_list_items to authenticated;

-- -----------------------------------------------------------------------------
-- View com dados do produto (respeita o RLS de quem consulta)
-- -----------------------------------------------------------------------------
create view public.shopping_list_items_view
with (security_invoker = true)
as
select
  i.id,
  i.list_id,
  i.household_id,
  i.household_product_id,
  coalesce(p.name, i.custom_name) as name,
  p.presentation,
  p.package_size,
  p.unit,
  b.name                          as brand_name,
  c.id                            as category_id,
  coalesce(c.name, 'Outros')      as category_name,
  coalesce(c.sort_order, 1000)    as category_sort,
  l.name                          as location_name,
  hp.ideal_qty,
  hp.current_qty,
  i.quantity,
  i.origin,
  i.manually_edited,
  i.estimated_unit_price,
  case when i.estimated_unit_price is not null
       then round(i.estimated_unit_price * i.quantity, 2) end as estimated_total,
  i.notes,
  i.checked_at,
  i.checked_by,
  i.created_at,
  i.updated_at
from public.shopping_list_items i
left join public.household_products hp on hp.id = i.household_product_id
left join public.products p on p.id = hp.product_id
left join public.brands b on b.id = p.brand_id
left join public.categories c on c.id = p.category_id
left join public.locations l on l.id = hp.location_id
where i.removed_at is null;

grant select on public.shopping_list_items_view to authenticated;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function private.require_editable_list(p_list_id uuid)
returns public.shopping_lists
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.shopping_lists%rowtype;
begin
  perform private.require_auth();
  select * into v_list from public.shopping_lists where id = p_list_id for update;
  if not found or not private.can_edit(v_list.household_id) then
    raise exception 'Lista não encontrada' using errcode = 'P0002';
  end if;
  if v_list.status <> 'open' then
    raise exception 'Esta lista já foi finalizada' using errcode = '22023';
  end if;
  return v_list;
end;
$$;

create or replace function private.require_editable_item(p_item_id uuid)
returns public.shopping_list_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.shopping_list_items%rowtype;
begin
  select * into v_item from public.shopping_list_items where id = p_item_id;
  if not found then
    raise exception 'Item não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_editable_list(v_item.list_id);
  select * into v_item from public.shopping_list_items where id = p_item_id for update;
  return v_item;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Retorna a lista aberta da família, criando se não existir.
create or replace function public.get_or_create_open_list(p_household_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_auth();
  v_id  uuid;
begin
  if not private.is_member(p_household_id) then
    raise exception 'Família não encontrada' using errcode = 'P0002';
  end if;
  select id into v_id from public.shopping_lists where household_id = p_household_id and status = 'open';
  if v_id is not null then
    return v_id;
  end if;
  if not private.can_edit(p_household_id) then
    return null; -- leitores não criam listas
  end if;
  insert into public.shopping_lists (household_id, created_by)
  values (p_household_id, v_uid)
  on conflict (household_id) where status = 'open' do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.shopping_lists where household_id = p_household_id and status = 'open';
  end if;
  return v_id;
end;
$$;

-- Gera/atualiza a lista a partir do estoque. Nunca duplica e nunca sobrescreve
-- itens manuais, editados, marcados ou removidos pelo usuário.
create or replace function public.generate_shopping_list(p_household_id uuid)
returns table (list_id uuid, added int, updated int, removed int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_auth();
  v_list_id uuid;
  v_added   int := 0;
  v_updated int := 0;
  v_removed int := 0;
begin
  if not private.can_edit(p_household_id) then
    raise exception 'Você não tem permissão para editar a lista' using errcode = '42501';
  end if;

  v_list_id := public.get_or_create_open_list(p_household_id);
  perform private.require_editable_list(v_list_id); -- trava a lista durante a geração

  -- 1) Atualiza quantidades de itens automáticos ainda não tocados pelo usuário.
  with need as (
    select hp.id, greatest(0, hp.ideal_qty - hp.current_qty) as qty
    from public.household_products hp
    where hp.household_id = p_household_id and hp.archived_at is null
  ), upd as (
    update public.shopping_list_items i
       set quantity = need.qty
      from need
     where i.list_id = v_list_id
       and i.household_product_id = need.id
       and i.origin = 'stock'
       and not i.manually_edited
       and i.checked_at is null
       and i.removed_at is null
       and need.qty > 0
       and i.quantity <> need.qty
    returning 1
  )
  select count(*) into v_updated from upd;

  -- 2) Remove itens automáticos que deixaram de ser necessários (não tocados).
  with del as (
    delete from public.shopping_list_items i
     using public.household_products hp
     where i.list_id = v_list_id
       and hp.id = i.household_product_id
       and i.origin = 'stock'
       and not i.manually_edited
       and i.checked_at is null
       and i.removed_at is null
       and (hp.archived_at is not null or hp.ideal_qty - hp.current_qty <= 0)
    returning 1
  )
  select count(*) into v_removed from del;

  -- 3) Inclui o que falta e ainda não está na lista (nem foi removido pelo usuário).
  with ins as (
    insert into public.shopping_list_items (list_id, household_id, household_product_id, quantity, origin, created_by)
    select v_list_id, p_household_id, hp.id, hp.ideal_qty - hp.current_qty, 'stock', v_uid
      from public.household_products hp
     where hp.household_id = p_household_id
       and hp.archived_at is null
       and hp.ideal_qty - hp.current_qty > 0
       and not exists (
         select 1 from public.shopping_list_items i
          where i.list_id = v_list_id and i.household_product_id = hp.id
       )
    on conflict do nothing
    returning 1
  )
  select count(*) into v_added from ins;

  update public.shopping_lists set updated_at = now() where id = v_list_id;
  return query select v_list_id, v_added, v_updated, v_removed;
end;
$$;

-- Adiciona um produto do estoque. Se já existir, soma a quantidade.
create or replace function public.add_product_to_list(
  p_list_id uuid,
  p_household_product_id uuid,
  p_quantity numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.shopping_lists%rowtype;
  v_hp_household uuid;
  v_id uuid;
begin
  v_list := private.require_editable_list(p_list_id);
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'A quantidade deve ser maior que zero' using errcode = '22023';
  end if;
  select household_id into v_hp_household from public.household_products
   where id = p_household_product_id and archived_at is null;
  perform private.assert_same_household(v_list.household_id, coalesce(v_hp_household, gen_random_uuid()),
                                        'Produto', false);

  insert into public.shopping_list_items (list_id, household_id, household_product_id, quantity, origin, manually_edited, created_by)
  values (p_list_id, v_list.household_id, p_household_product_id, p_quantity, 'manual', true, auth.uid())
  on conflict (list_id, household_product_id) where household_product_id is not null
  do update set
    -- Se estava removido, volta com a quantidade pedida; senão, soma.
    quantity = case when public.shopping_list_items.removed_at is not null then excluded.quantity
                    else public.shopping_list_items.quantity + excluded.quantity end,
    removed_at = null,
    manually_edited = true
  returning id into v_id;
  return v_id;
end;
$$;

-- Adiciona um item livre (fora do estoque), ex.: "Vela de aniversário".
create or replace function public.add_custom_item_to_list(p_list_id uuid, p_name text, p_quantity numeric default 1)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.shopping_lists%rowtype;
  v_id uuid;
begin
  v_list := private.require_editable_list(p_list_id);
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'A quantidade deve ser maior que zero' using errcode = '22023';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then
    raise exception 'Informe o nome do item' using errcode = '22023';
  end if;

  insert into public.shopping_list_items (list_id, household_id, custom_name, quantity, origin, manually_edited, created_by)
  values (p_list_id, v_list.household_id, trim(p_name), p_quantity, 'manual', true, auth.uid())
  on conflict (list_id, lower(trim(custom_name))) where household_product_id is null
  do update set
    quantity = case when public.shopping_list_items.removed_at is not null then excluded.quantity
                    else public.shopping_list_items.quantity + excluded.quantity end,
    removed_at = null
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_list_item(
  p_item_id uuid,
  p_quantity numeric,
  p_estimated_unit_price numeric default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.shopping_list_items%rowtype;
begin
  v_item := private.require_editable_item(p_item_id);
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'A quantidade deve ser maior que zero' using errcode = '22023';
  end if;
  if p_estimated_unit_price is not null and p_estimated_unit_price < 0 then
    raise exception 'Preço inválido' using errcode = '22023';
  end if;
  update public.shopping_list_items
     set quantity = p_quantity,
         manually_edited = manually_edited or quantity <> p_quantity,
         estimated_unit_price = p_estimated_unit_price,
         notes = nullif(trim(p_notes), '')
   where id = p_item_id;
end;
$$;

create or replace function public.set_list_item_checked(p_item_id uuid, p_checked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.shopping_list_items%rowtype;
begin
  v_item := private.require_editable_item(p_item_id);
  update public.shopping_list_items
     set checked_at = case when p_checked then coalesce(checked_at, now()) end,
         checked_by = case when p_checked then coalesce(checked_by, auth.uid()) end
   where id = p_item_id;
end;
$$;

-- Remove da lista. Fica marcado para não voltar na próxima geração.
create or replace function public.remove_list_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.shopping_list_items%rowtype;
begin
  v_item := private.require_editable_item(p_item_id);
  update public.shopping_list_items set removed_at = now(), checked_at = null, checked_by = null
   where id = p_item_id;
end;
$$;

-- Finaliza a lista. Com p_apply_to_stock, os itens MARCADOS que são produtos
-- do estoque entram como compra confirmada. Idempotente: repetir não duplica.
create or replace function public.complete_shopping_list(p_list_id uuid, p_apply_to_stock boolean default false)
returns table (applied_items int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_auth();
  v_list  public.shopping_lists%rowtype;
  v_item  record;
  v_count int := 0;
begin
  select * into v_list from public.shopping_lists where id = p_list_id for update;
  if not found or not private.can_edit(v_list.household_id) then
    raise exception 'Lista não encontrada' using errcode = 'P0002';
  end if;

  -- Já finalizada: devolve sem refazer nada (clique duplo, nova tentativa de rede).
  if v_list.status = 'completed' then
    return query select 0;
    return;
  end if;
  if v_list.status <> 'open' then
    raise exception 'Esta lista não pode ser finalizada' using errcode = '22023';
  end if;

  if p_apply_to_stock then
    for v_item in
      select i.id, i.household_product_id, i.quantity
        from public.shopping_list_items i
        join public.household_products hp on hp.id = i.household_product_id and hp.archived_at is null
       where i.list_id = p_list_id and i.checked_at is not null and i.removed_at is null
    loop
      perform private.apply_stock_movement(
        v_item.household_product_id, 'purchase', v_item.quantity, 'purchase', p_list_id,
        'Lista de compras finalizada', 'list:' || v_item.id::text);
      v_count := v_count + 1;
    end loop;
  end if;

  update public.shopping_lists
     set status = 'completed',
         completed_at = now(),
         completed_by = v_uid,
         stock_applied_at = case when p_apply_to_stock then now() end
   where id = p_list_id;

  perform private.audit(v_list.household_id, 'shopping_list.completed', 'shopping_list', p_list_id::text,
                        jsonb_build_object('applied_items', v_count, 'apply_to_stock', p_apply_to_stock));
  return query select v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------
revoke execute on function
  private.require_editable_list(uuid),
  private.require_editable_item(uuid)
from public, anon, authenticated;

revoke execute on function
  public.get_or_create_open_list(uuid),
  public.generate_shopping_list(uuid),
  public.add_product_to_list(uuid, uuid, numeric),
  public.add_custom_item_to_list(uuid, text, numeric),
  public.update_list_item(uuid, numeric, numeric, text),
  public.set_list_item_checked(uuid, boolean),
  public.remove_list_item(uuid),
  public.complete_shopping_list(uuid, boolean)
from public, anon;

grant execute on function
  public.get_or_create_open_list(uuid),
  public.generate_shopping_list(uuid),
  public.add_product_to_list(uuid, uuid, numeric),
  public.add_custom_item_to_list(uuid, text, numeric),
  public.update_list_item(uuid, numeric, numeric, text),
  public.set_list_item_checked(uuid, boolean),
  public.remove_list_item(uuid),
  public.complete_shopping_list(uuid, boolean)
to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shopping_lists, public.shopping_list_items;
  end if;
end;
$$;
