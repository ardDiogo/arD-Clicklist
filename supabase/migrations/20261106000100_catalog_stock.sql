-- =============================================================================
-- FASE 2 — Catálogo, ambientes e estoque doméstico
-- =============================================================================
-- Regras centrais:
--   * Estoque é contado em EMBALAGENS do produto (ex.: 3 ketchups).
--   * household_products.current_qty só muda por meio de uma movimentação
--     (stock_movements), criada dentro de função transacional que trava a linha.
--   * Não existe estoque negativo; movimentações nunca são editadas nem apagadas.
--   * Catálogo: registros com household_id NULL são globais (somente leitura);
--     registros com household_id pertencem à família que os criou.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.measure_unit as enum ('un', 'g', 'kg', 'ml', 'l');

create type public.stock_movement_type as enum (
  'purchase',             -- compra confirmada
  'consumption',          -- consumo manual
  'inventory_adjustment', -- ajuste de inventário (contagem)
  'correction',           -- correção manual
  'transfer'              -- transferência entre ambientes
);

create type public.stock_movement_source as enum ('manual', 'purchase', 'inventory_scan', 'system');

-- -----------------------------------------------------------------------------
-- Validação: referência deve ser global (NULL) ou da mesma família
-- -----------------------------------------------------------------------------
create or replace function private.assert_same_household(
  p_household_id uuid,
  p_ref_household_id uuid,
  p_what text,
  p_allow_global boolean default true
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_ref_household_id is null and p_allow_global then
    return;
  end if;
  if p_ref_household_id is distinct from p_household_id then
    raise exception '% pertence a outra família', p_what using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Categorias
-- -----------------------------------------------------------------------------
create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references public.households (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 60),
  icon          text,
  sort_order    int not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create unique index categories_unique_name
  on public.categories (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where archived_at is null;

create trigger categories_updated_at before update on public.categories
  for each row execute function private.set_updated_at();
create trigger categories_immutable_household before update on public.categories
  for each row execute function private.prevent_household_change();

insert into public.categories (name, icon, sort_order) values
  ('Mercearia',        'wheat',        10),
  ('Bebidas',          'cup-soda',     20),
  ('Hortifruti',       'apple',        30),
  ('Carnes e frios',   'beef',         40),
  ('Higiene pessoal',  'bath',         50),
  ('Limpeza',          'spray-can',    60),
  ('Lavanderia',       'shirt',        70),
  ('Descartáveis',     'package-open', 80),
  ('Outros',           'shapes',       90);

-- -----------------------------------------------------------------------------
-- Marcas
-- -----------------------------------------------------------------------------
create table public.brands (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references public.households (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 60),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index brands_unique_name
  on public.brands (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create trigger brands_updated_at before update on public.brands
  for each row execute function private.set_updated_at();
create trigger brands_immutable_household before update on public.brands
  for each row execute function private.prevent_household_change();

-- -----------------------------------------------------------------------------
-- Produtos (catálogo)
-- -----------------------------------------------------------------------------
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references public.households (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 120),
  brand_id      uuid references public.brands (id) on delete set null,
  category_id   uuid references public.categories (id) on delete set null,
  barcode       text check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  presentation  text check (presentation is null or char_length(presentation) <= 60),
  package_size  numeric(12, 3) check (package_size is null or package_size > 0),
  unit          public.measure_unit not null default 'un',
  description   text check (description is null or char_length(description) <= 500),
  image_path    text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index products_household_idx on public.products (household_id) where deleted_at is null;
create unique index products_unique_barcode
  on public.products (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), barcode)
  where barcode is not null and deleted_at is null;

create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();
create trigger products_immutable_household before update on public.products
  for each row execute function private.prevent_household_change();

create or replace function private.products_check_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.brand_id is not null then
    perform private.assert_same_household(new.household_id,
      (select household_id from public.brands where id = new.brand_id), 'Marca');
  end if;
  if new.category_id is not null then
    perform private.assert_same_household(new.household_id,
      (select household_id from public.categories where id = new.category_id), 'Categoria');
  end if;
  return new;
end;
$$;

create trigger products_check_refs before insert or update on public.products
  for each row execute function private.products_check_refs();

-- -----------------------------------------------------------------------------
-- Ambientes (sempre da família)
-- -----------------------------------------------------------------------------
create table public.locations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 60),
  sort_order    int not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create unique index locations_unique_name
  on public.locations (household_id, lower(name)) where archived_at is null;

create trigger locations_updated_at before update on public.locations
  for each row execute function private.set_updated_at();
create trigger locations_immutable_household before update on public.locations
  for each row execute function private.prevent_household_change();

create or replace function private.seed_household_locations(p_household_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.locations (household_id, name, sort_order)
  select p_household_id, l.name, l.sort_order
  from (values
    ('Despensa', 10), ('Geladeira', 20), ('Freezer', 30), ('Armário da cozinha', 40),
    ('Banheiro', 50), ('Lavanderia', 60), ('Área de serviço', 70), ('Outros', 80)
  ) as l(name, sort_order)
  on conflict do nothing;
$$;

create or replace function private.households_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_household_locations(new.id);
  return new;
end;
$$;

create trigger households_seed_locations after insert on public.households
  for each row execute function private.households_after_insert();

-- Famílias criadas na Fase 1 recebem os ambientes padrão.
select private.seed_household_locations(id) from public.households;

-- -----------------------------------------------------------------------------
-- Produtos controlados pela família (estoque)
-- -----------------------------------------------------------------------------
create table public.household_products (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  product_id        uuid not null references public.products (id) on delete restrict,
  location_id       uuid references public.locations (id) on delete set null,
  ideal_qty         numeric(12, 3) not null default 0 check (ideal_qty >= 0),
  current_qty       numeric(12, 3) not null default 0 check (current_qty >= 0),
  notes             text check (notes is null or char_length(notes) <= 500),
  last_movement_at  timestamptz,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz
);

create unique index household_products_unique
  on public.household_products (household_id, product_id) where archived_at is null;
create index household_products_location_idx on public.household_products (location_id);

create trigger household_products_updated_at before update on public.household_products
  for each row execute function private.set_updated_at();
create trigger household_products_immutable_household before update on public.household_products
  for each row execute function private.prevent_household_change();

create or replace function private.household_products_check_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_same_household(new.household_id,
    (select household_id from public.products where id = new.product_id), 'Produto');
  if new.location_id is not null then
    perform private.assert_same_household(new.household_id,
      (select household_id from public.locations where id = new.location_id), 'Ambiente', false);
  end if;
  return new;
end;
$$;

create trigger household_products_check_refs before insert or update on public.household_products
  for each row execute function private.household_products_check_refs();

-- -----------------------------------------------------------------------------
-- Movimentações (livro-razão imutável)
-- -----------------------------------------------------------------------------
create table public.stock_movements (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households (id) on delete cascade,
  household_product_id  uuid not null references public.household_products (id) on delete cascade,
  type                  public.stock_movement_type not null,
  source                public.stock_movement_source not null default 'manual',
  source_id             uuid,
  quantity_delta        numeric(12, 3) not null,
  quantity_before       numeric(12, 3) not null check (quantity_before >= 0),
  quantity_after        numeric(12, 3) not null check (quantity_after >= 0),
  from_location_id      uuid references public.locations (id) on delete set null,
  to_location_id        uuid references public.locations (id) on delete set null,
  note                  text check (note is null or char_length(note) <= 500),
  idempotency_key       text check (idempotency_key is null or char_length(idempotency_key) between 8 and 120),
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint stock_movements_math check (quantity_after = quantity_before + quantity_delta),
  constraint stock_movements_transfer check (type <> 'transfer' or quantity_delta = 0)
);

create index stock_movements_product_idx on public.stock_movements (household_product_id, created_at desc);
create index stock_movements_household_idx on public.stock_movements (household_id, created_at desc);
create unique index stock_movements_idempotency
  on public.stock_movements (household_id, idempotency_key) where idempotency_key is not null;

-- Defesa extra: nem mesmo o dono das tabelas altera o histórico por engano.
create or replace function private.block_movement_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Movimentações de estoque são imutáveis' using errcode = '42501';
end;
$$;

create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row
  -- Exclusões em cascata (ex.: família apagada) vêm de gatilhos internos e são permitidas.
  when (pg_trigger_depth() = 0)
  execute function private.block_movement_changes();

-- -----------------------------------------------------------------------------
-- Núcleo transacional: aplica uma movimentação travando o item
-- -----------------------------------------------------------------------------
create or replace function private.apply_stock_movement(
  p_household_product_id uuid,
  p_type public.stock_movement_type,
  p_delta numeric,
  p_source public.stock_movement_source default 'manual',
  p_source_id uuid default null,
  p_note text default null,
  p_idempotency_key text default null,
  p_to_location_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item      public.household_products%rowtype;
  v_existing  uuid;
  v_after     numeric(12, 3);
  v_id        uuid;
begin
  select * into v_item
    from public.household_products
   where id = p_household_product_id
   for update;

  if not found or v_item.archived_at is not null then
    raise exception 'Item de estoque não encontrado' using errcode = 'P0002';
  end if;

  -- Idempotência: mesmo pedido repetido devolve a movimentação já registrada.
  if p_idempotency_key is not null then
    select id into v_existing
      from public.stock_movements
     where household_id = v_item.household_id and idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_after := v_item.current_qty + coalesce(p_delta, 0);
  if v_after < 0 then
    raise exception 'Estoque insuficiente: há % e a operação retiraria %',
      trim_scale(v_item.current_qty), trim_scale(-p_delta) using errcode = '22023';
  end if;

  if p_type = 'transfer' then
    if p_to_location_id is null then
      raise exception 'Informe o ambiente de destino' using errcode = '22023';
    end if;
    perform private.assert_same_household(v_item.household_id,
      (select household_id from public.locations where id = p_to_location_id and archived_at is null),
      'Ambiente', false);
  end if;

  insert into public.stock_movements (
    household_id, household_product_id, type, source, source_id,
    quantity_delta, quantity_before, quantity_after,
    from_location_id, to_location_id, note, idempotency_key, created_by
  ) values (
    v_item.household_id, v_item.id, p_type, p_source, p_source_id,
    coalesce(p_delta, 0), v_item.current_qty, v_after,
    case when p_type = 'transfer' then v_item.location_id end,
    case when p_type = 'transfer' then p_to_location_id end,
    nullif(trim(p_note), ''), p_idempotency_key, auth.uid()
  )
  returning id into v_id;

  update public.household_products
     set current_qty = v_after,
         location_id = case when p_type = 'transfer' then p_to_location_id else location_id end,
         last_movement_at = now()
   where id = v_item.id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.categories         enable row level security;
alter table public.brands             enable row level security;
alter table public.products           enable row level security;
alter table public.locations          enable row level security;
alter table public.household_products enable row level security;
alter table public.stock_movements    enable row level security;

-- Catálogo: globais visíveis a todos os autenticados; próprios só para a família.
create policy categories_select on public.categories for select to authenticated
  using (household_id is null or private.is_member(household_id));
create policy categories_insert on public.categories for insert to authenticated
  with check (household_id is not null and private.can_edit(household_id));
create policy categories_update on public.categories for update to authenticated
  using (household_id is not null and private.can_edit(household_id))
  with check (household_id is not null and private.can_edit(household_id));

create policy brands_select on public.brands for select to authenticated
  using (household_id is null or private.is_member(household_id));
create policy brands_insert on public.brands for insert to authenticated
  with check (household_id is not null and private.can_edit(household_id));
create policy brands_update on public.brands for update to authenticated
  using (household_id is not null and private.can_edit(household_id))
  with check (household_id is not null and private.can_edit(household_id));

create policy products_select on public.products for select to authenticated
  using (household_id is null or private.is_member(household_id));
create policy products_insert on public.products for insert to authenticated
  with check (household_id is not null and private.can_edit(household_id));
create policy products_update on public.products for update to authenticated
  using (household_id is not null and private.can_edit(household_id))
  with check (household_id is not null and private.can_edit(household_id));

create policy locations_select on public.locations for select to authenticated
  using (private.is_member(household_id));
create policy locations_insert on public.locations for insert to authenticated
  with check (private.can_edit(household_id));
create policy locations_update on public.locations for update to authenticated
  using (private.can_edit(household_id))
  with check (private.can_edit(household_id));

create policy household_products_select on public.household_products for select to authenticated
  using (private.is_member(household_id));
create policy household_products_update on public.household_products for update to authenticated
  using (private.can_edit(household_id))
  with check (private.can_edit(household_id));

create policy stock_movements_select on public.stock_movements for select to authenticated
  using (private.is_member(household_id));

-- Privilégios: nada de DELETE físico; colunas sensíveis fora do alcance do cliente.
revoke all on public.categories, public.brands, public.products, public.locations,
              public.household_products, public.stock_movements from anon, authenticated;

grant select on public.categories, public.brands, public.products, public.locations,
                public.household_products, public.stock_movements to authenticated;

grant insert (household_id, name, icon, sort_order) on public.categories to authenticated;
grant update (name, icon, sort_order, archived_at) on public.categories to authenticated;
grant insert (household_id, name) on public.brands to authenticated;
grant update (name) on public.brands to authenticated;
grant insert (household_id, name, brand_id, category_id, barcode, presentation, package_size, unit, description)
  on public.products to authenticated;
grant update (name, brand_id, category_id, barcode, presentation, package_size, unit, description, deleted_at)
  on public.products to authenticated;
grant insert (household_id, name, sort_order) on public.locations to authenticated;
grant update (name, sort_order, archived_at) on public.locations to authenticated;
-- current_qty e location_id NÃO são editáveis diretamente: só via movimentação.
grant update (ideal_qty, notes) on public.household_products to authenticated;

-- -----------------------------------------------------------------------------
-- View de leitura do estoque (respeita o RLS de quem consulta)
-- -----------------------------------------------------------------------------
create view public.household_stock
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
  greatest(0, hp.ideal_qty - hp.current_qty) as to_buy_qty,
  case
    when hp.ideal_qty = 0 then 'untracked'
    when hp.current_qty = 0 then 'out'
    when hp.current_qty < hp.ideal_qty then 'low'
    else 'ok'
  end                as status,
  hp.notes,
  hp.last_movement_at,
  hp.created_at,
  hp.updated_at
from public.household_products hp
join public.products p on p.id = hp.product_id
left join public.brands b on b.id = p.brand_id
left join public.categories c on c.id = p.category_id
left join public.locations l on l.id = hp.location_id
where hp.archived_at is null;

grant select on public.household_stock to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Busca ou cria a marca da família pelo nome (sem duplicar por maiúsculas).
create or replace function private.resolve_brand(p_household_id uuid, p_brand_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(trim(p_brand_name), '');
  v_id   uuid;
begin
  if v_name is null then
    return null;
  end if;
  select id into v_id from public.brands
   where lower(name) = lower(v_name)
     and (household_id = p_household_id or household_id is null)
   order by household_id nulls last
   limit 1;
  if v_id is null then
    insert into public.brands (household_id, name) values (p_household_id, v_name)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.brands
       where household_id = p_household_id and lower(name) = lower(v_name);
    end if;
  end if;
  return v_id;
end;
$$;

-- Cadastra um produto e já o coloca no estoque da família, numa única transação.
create or replace function public.create_tracked_product(
  p_household_id uuid,
  p_name text,
  p_brand_name text default null,
  p_category_id uuid default null,
  p_presentation text default null,
  p_package_size numeric default null,
  p_unit public.measure_unit default 'un',
  p_barcode text default null,
  p_location_id uuid default null,
  p_ideal_qty numeric default 0,
  p_current_qty numeric default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := private.require_auth();
  v_product_id uuid;
  v_item_id    uuid;
begin
  if not private.can_edit(p_household_id) then
    raise exception 'Você não tem permissão para editar o estoque desta família' using errcode = '42501';
  end if;
  if coalesce(p_ideal_qty, 0) < 0 or coalesce(p_current_qty, 0) < 0 then
    raise exception 'Quantidades não podem ser negativas' using errcode = '22023';
  end if;

  insert into public.products (
    household_id, name, brand_id, category_id, presentation, package_size, unit, barcode, created_by
  ) values (
    p_household_id, trim(p_name), private.resolve_brand(p_household_id, p_brand_name), p_category_id,
    nullif(trim(p_presentation), ''), p_package_size, coalesce(p_unit, 'un'),
    nullif(regexp_replace(coalesce(p_barcode, ''), '\D', '', 'g'), ''), v_uid
  )
  returning id into v_product_id;

  insert into public.household_products (household_id, product_id, location_id, ideal_qty, notes, created_by)
  values (p_household_id, v_product_id, p_location_id, coalesce(p_ideal_qty, 0), nullif(trim(p_notes), ''), v_uid)
  returning id into v_item_id;

  if coalesce(p_current_qty, 0) > 0 then
    perform private.apply_stock_movement(v_item_id, 'inventory_adjustment', p_current_qty,
                                         'manual', null, 'Quantidade inicial no cadastro');
  end if;

  perform private.audit(p_household_id, 'product.created', 'household_product', v_item_id::text,
                        jsonb_build_object('product_id', v_product_id, 'name', trim(p_name)));
  return v_item_id;
end;
$$;

-- Atualiza dados do produto da família (catálogo + parâmetros de estoque).
create or replace function public.update_tracked_product(
  p_household_product_id uuid,
  p_name text,
  p_brand_name text default null,
  p_category_id uuid default null,
  p_presentation text default null,
  p_package_size numeric default null,
  p_unit public.measure_unit default 'un',
  p_barcode text default null,
  p_ideal_qty numeric default 0,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.household_products%rowtype;
  v_product public.products%rowtype;
begin
  perform private.require_auth();
  select * into v_item from public.household_products where id = p_household_product_id and archived_at is null;
  if not found or not private.can_edit(v_item.household_id) then
    raise exception 'Item de estoque não encontrado' using errcode = 'P0002';
  end if;
  if coalesce(p_ideal_qty, 0) < 0 then
    raise exception 'Quantidades não podem ser negativas' using errcode = '22023';
  end if;

  select * into v_product from public.products where id = v_item.product_id;
  if v_product.household_id is null then
    raise exception 'Produtos do catálogo global não podem ser editados' using errcode = '42501';
  end if;

  update public.products
     set name = trim(p_name),
         brand_id = private.resolve_brand(v_item.household_id, p_brand_name),
         category_id = p_category_id,
         presentation = nullif(trim(p_presentation), ''),
         package_size = p_package_size,
         unit = coalesce(p_unit, 'un'),
         barcode = nullif(regexp_replace(coalesce(p_barcode, ''), '\D', '', 'g'), '')
   where id = v_product.id;

  update public.household_products
     set ideal_qty = coalesce(p_ideal_qty, 0),
         notes = nullif(trim(p_notes), '')
   where id = v_item.id;

  perform private.audit(v_item.household_id, 'product.updated', 'household_product', v_item.id::text);
end;
$$;

-- Registra uma movimentação manual.
--   consumption          : p_quantity > 0 unidades consumidas (retira)
--   purchase             : p_quantity > 0 unidades compradas (entra)
--   correction           : p_quantity com sinal (+/-)
--   inventory_adjustment : p_quantity = nova contagem absoluta
create or replace function public.record_stock_movement(
  p_household_product_id uuid,
  p_type public.stock_movement_type,
  p_quantity numeric,
  p_note text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  public.household_products%rowtype;
  v_delta numeric;
begin
  perform private.require_auth();
  select * into v_item from public.household_products where id = p_household_product_id;
  if not found or not private.can_edit(v_item.household_id) then
    raise exception 'Item de estoque não encontrado' using errcode = 'P0002';
  end if;
  if p_quantity is null then
    raise exception 'Informe a quantidade' using errcode = '22023';
  end if;

  v_delta := case p_type
    when 'consumption' then -p_quantity
    when 'purchase' then p_quantity
    when 'correction' then p_quantity
    when 'inventory_adjustment' then p_quantity - v_item.current_qty
    else null
  end;

  if p_type = 'transfer' then
    raise exception 'Use transfer_household_product para transferências' using errcode = '22023';
  end if;
  if p_type in ('consumption', 'purchase') and p_quantity <= 0 then
    raise exception 'A quantidade deve ser maior que zero' using errcode = '22023';
  end if;
  if p_type = 'inventory_adjustment' and p_quantity < 0 then
    raise exception 'A contagem não pode ser negativa' using errcode = '22023';
  end if;
  if p_type = 'correction' and p_quantity = 0 then
    raise exception 'A correção não pode ser zero' using errcode = '22023';
  end if;

  return private.apply_stock_movement(v_item.id, p_type, v_delta, 'manual', null, p_note, p_idempotency_key);
end;
$$;

create or replace function public.transfer_household_product(
  p_household_product_id uuid,
  p_to_location_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.household_products%rowtype;
begin
  perform private.require_auth();
  select * into v_item from public.household_products where id = p_household_product_id;
  if not found or not private.can_edit(v_item.household_id) then
    raise exception 'Item de estoque não encontrado' using errcode = 'P0002';
  end if;
  if v_item.location_id is not distinct from p_to_location_id then
    raise exception 'O produto já está neste ambiente' using errcode = '22023';
  end if;
  return private.apply_stock_movement(v_item.id, 'transfer', 0, 'manual', null, p_note, null, p_to_location_id);
end;
$$;

-- Arquiva (soft delete) um item de estoque. O histórico permanece.
create or replace function public.archive_household_product(p_household_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  perform private.require_auth();
  select household_id into v_household from public.household_products
   where id = p_household_product_id and archived_at is null;
  if v_household is null or not private.can_edit(v_household) then
    raise exception 'Item de estoque não encontrado' using errcode = 'P0002';
  end if;
  update public.household_products set archived_at = now() where id = p_household_product_id;
  perform private.audit(v_household, 'product.archived', 'household_product', p_household_product_id::text);
end;
$$;

-- Arquiva um ambiente; itens nele ficam "sem ambiente".
create or replace function public.archive_location(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  perform private.require_auth();
  select household_id into v_household from public.locations where id = p_location_id and archived_at is null;
  if v_household is null or not private.can_edit(v_household) then
    raise exception 'Ambiente não encontrado' using errcode = 'P0002';
  end if;
  update public.household_products set location_id = null where location_id = p_location_id;
  update public.locations set archived_at = now() where id = p_location_id;
  perform private.audit(v_household, 'location.archived', 'location', p_location_id::text);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões de execução
-- -----------------------------------------------------------------------------
revoke execute on function
  private.assert_same_household(uuid, uuid, text, boolean),
  private.products_check_refs(),
  private.seed_household_locations(uuid),
  private.households_after_insert(),
  private.household_products_check_refs(),
  private.block_movement_changes(),
  private.apply_stock_movement(uuid, public.stock_movement_type, numeric, public.stock_movement_source, uuid, text, text, uuid),
  private.resolve_brand(uuid, text)
from public, anon, authenticated;

revoke execute on function
  public.create_tracked_product(uuid, text, text, uuid, text, numeric, public.measure_unit, text, uuid, numeric, numeric, text),
  public.update_tracked_product(uuid, text, text, uuid, text, numeric, public.measure_unit, text, numeric, text),
  public.record_stock_movement(uuid, public.stock_movement_type, numeric, text, text),
  public.transfer_household_product(uuid, uuid, text),
  public.archive_household_product(uuid),
  public.archive_location(uuid)
from public, anon;

grant execute on function
  public.create_tracked_product(uuid, text, text, uuid, text, numeric, public.measure_unit, text, uuid, numeric, numeric, text),
  public.update_tracked_product(uuid, text, text, uuid, text, numeric, public.measure_unit, text, numeric, text),
  public.record_stock_movement(uuid, public.stock_movement_type, numeric, text, text),
  public.transfer_household_product(uuid, uuid, text),
  public.archive_household_product(uuid),
  public.archive_location(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.household_products, public.stock_movements, public.locations;
  end if;
end;
$$;
