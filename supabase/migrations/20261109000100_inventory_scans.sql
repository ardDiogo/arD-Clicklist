-- =============================================================================
-- FASE 5 — Inventário por fotografias
-- =============================================================================
-- Regras:
--   * Fotografia de armário é CONFERÊNCIA de inventário, não compra.
--   * A IA só sugere: produtos, quantidades e grau de confiança. Nada muda no
--     estoque sem confirmação humana.
--   * Quantidade não identificada fica NULL (a IA não inventa números).
--   * Produtos esperados no ambiente que não apareceram nas fotos são listados
--     para o usuário decidir (acabou? está escondido?).
--   * A confirmação aplica ajustes de inventário (contagem) numa transação,
--     de forma idempotente.
-- =============================================================================

create type public.inventory_scan_status as enum ('draft', 'confirmed', 'discarded');
create type public.inventory_item_origin as enum ('detected', 'expected');
create type public.inventory_item_status as enum ('pending', 'confirmed', 'ignored');

create table public.inventory_scans (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  location_id   uuid references public.locations (id) on delete set null,
  status        public.inventory_scan_status not null default 'draft',
  model         text check (model is null or char_length(model) <= 80),
  analyzed_at   timestamptz,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_by    uuid references auth.users (id) on delete set null,
  confirmed_by  uuid references auth.users (id) on delete set null,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index inventory_scans_household_idx on public.inventory_scans (household_id, created_at desc);

create trigger inventory_scans_updated_at before update on public.inventory_scans
  for each row execute function private.set_updated_at();
create trigger inventory_scans_immutable_household before update on public.inventory_scans
  for each row execute function private.prevent_household_change();

create table public.inventory_scan_files (
  id            uuid primary key default gen_random_uuid(),
  scan_id       uuid not null references public.inventory_scans (id) on delete cascade,
  household_id  uuid not null references public.households (id) on delete cascade,
  position      int not null check (position between 1 and 12),
  storage_path  text not null unique,
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes    int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (scan_id, position)
);

create table public.inventory_scan_items (
  id                    uuid primary key default gen_random_uuid(),
  scan_id               uuid not null references public.inventory_scans (id) on delete cascade,
  household_id          uuid not null references public.households (id) on delete cascade,
  origin                public.inventory_item_origin not null,
  household_product_id  uuid references public.household_products (id) on delete set null,
  detected_name         text check (detected_name is null or char_length(detected_name) <= 160),
  detected_brand        text check (detected_brand is null or char_length(detected_brand) <= 80),
  detected_details      text check (detected_details is null or char_length(detected_details) <= 200),
  estimated_quantity    numeric(12, 3) check (estimated_quantity is null or estimated_quantity >= 0),
  confidence            numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  partially_hidden      boolean not null default false,
  photo_positions       int[] not null default '{}',
  system_quantity       numeric(12, 3),
  confirmed_quantity    numeric(12, 3) check (confirmed_quantity is null or confirmed_quantity >= 0),
  status                public.inventory_item_status not null default 'pending',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint inventory_items_what check (household_product_id is not null or detected_name is not null)
);

create index inventory_scan_items_scan_idx on public.inventory_scan_items (scan_id);

create trigger inventory_scan_items_updated_at before update on public.inventory_scan_items
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS (leitura para membros; escrita via RPC)
-- -----------------------------------------------------------------------------
alter table public.inventory_scans      enable row level security;
alter table public.inventory_scan_files enable row level security;
alter table public.inventory_scan_items enable row level security;

create policy inventory_scans_select on public.inventory_scans for select to authenticated using (private.is_member(household_id));
create policy inventory_scan_files_select on public.inventory_scan_files for select to authenticated using (private.is_member(household_id));
create policy inventory_scan_items_select on public.inventory_scan_items for select to authenticated using (private.is_member(household_id));

revoke all on public.inventory_scans, public.inventory_scan_files, public.inventory_scan_items from anon, authenticated;
grant select on public.inventory_scans, public.inventory_scan_files, public.inventory_scan_items to authenticated;

-- Bucket privado para as fotos dos ambientes (mesma regra de pasta = família).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-photos', 'inventory-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy inventory_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'inventory-photos' and private.storage_household_access(name, false));
create policy inventory_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'inventory-photos' and private.storage_household_access(name, true));

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function private.require_draft_scan(p_scan_id uuid)
returns public.inventory_scans
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.inventory_scans%rowtype;
begin
  perform private.require_auth();
  select * into v_s from public.inventory_scans where id = p_scan_id for update;
  if not found or not private.can_edit(v_s.household_id) then
    raise exception 'Conferência não encontrada' using errcode = 'P0002';
  end if;
  if v_s.status <> 'draft' then
    raise exception 'Esta conferência já foi %',
      case v_s.status when 'confirmed' then 'confirmada' else 'descartada' end using errcode = '22023';
  end if;
  return v_s;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create or replace function public.create_inventory_scan(p_household_id uuid, p_location_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_auth();
  v_id  uuid;
begin
  if not private.can_edit(p_household_id) then
    raise exception 'Você não tem permissão para conferir o estoque' using errcode = '42501';
  end if;
  if p_location_id is not null then
    perform private.assert_same_household(p_household_id,
      coalesce((select household_id from public.locations where id = p_location_id and archived_at is null), gen_random_uuid()),
      'Ambiente', false);
  end if;
  insert into public.inventory_scans (household_id, location_id, created_by)
  values (p_household_id, p_location_id, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.register_inventory_photo(
  p_scan_id uuid,
  p_position int,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes int,
  p_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s  public.inventory_scans%rowtype;
  v_id uuid;
begin
  v_s := private.require_draft_scan(p_scan_id);
  if split_part(p_storage_path, '/', 1) <> v_s.household_id::text or p_storage_path like '%..%' then
    raise exception 'Caminho de arquivo inválido' using errcode = '22023';
  end if;
  insert into public.inventory_scan_files (scan_id, household_id, position, storage_path, mime_type, size_bytes, sha256, created_by)
  values (p_scan_id, v_s.household_id, p_position, p_storage_path, p_mime_type, p_size_bytes, lower(p_sha256), auth.uid())
  on conflict (scan_id, position) do update
    set storage_path = excluded.storage_path, mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes, sha256 = excluded.sha256
  returning id into v_id;
  return v_id;
end;
$$;

-- Grava o resultado da análise. p_detections: [{ name, brand, details, quantity,
-- confidence, partially_hidden, photos: [int], product_id }]. Reprocessar substitui
-- o resultado anterior (enquanto rascunho).
create or replace function public.save_inventory_detections(p_scan_id uuid, p_detections jsonb, p_model text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s      public.inventory_scans%rowtype;
  v_d      jsonb;
  v_pid    uuid;
  v_conf   numeric;
  v_qty    numeric;
  v_hidden boolean;
  v_count  int := 0;
  v_key    text;
begin
  v_s := private.require_draft_scan(p_scan_id);
  if jsonb_typeof(p_detections) <> 'array' then
    raise exception 'Formato de detecções inválido' using errcode = '22023';
  end if;
  if jsonb_array_length(p_detections) > 200 then
    raise exception 'Detecções demais' using errcode = '22023';
  end if;

  delete from public.inventory_scan_items where scan_id = p_scan_id;

  for v_d in select * from jsonb_array_elements(p_detections)
  loop
    -- Produto indicado pela IA só vale se for desta família.
    v_pid := null;
    if coalesce(v_d ->> 'product_id', '') ~ '^[0-9a-f-]{36}$' then
      select id into v_pid from public.household_products
       where id = (v_d ->> 'product_id')::uuid and household_id = v_s.household_id and archived_at is null;
    end if;
    -- Senão, tenta pelo nome aprendido em conferências anteriores.
    if v_pid is null then
      v_key := private.normalize_text(concat_ws(' ', v_d ->> 'name', v_d ->> 'brand'));
      if v_key is not null then
        select a.household_product_id into v_pid
          from public.product_aliases a
          join public.household_products hp on hp.id = a.household_product_id and hp.archived_at is null
         where a.household_id = v_s.household_id and a.kind = 'description' and a.key = v_key
         order by (a.store_cnpj = '__scan__') desc, a.times_used desc
         limit 1;
      end if;
    end if;

    v_conf := least(1, greatest(0, coalesce(nullif(v_d ->> 'confidence', '')::numeric, 0)));
    v_qty := nullif(v_d ->> 'quantity', '')::numeric;
    if v_qty is not null and v_qty < 0 then v_qty := null; end if;
    v_hidden := coalesce((v_d ->> 'partially_hidden')::boolean, false);

    insert into public.inventory_scan_items (
      scan_id, household_id, origin, household_product_id, detected_name, detected_brand, detected_details,
      estimated_quantity, confidence, partially_hidden, photo_positions, system_quantity,
      confirmed_quantity, status
    ) values (
      p_scan_id, v_s.household_id, 'detected', v_pid,
      coalesce(nullif(left(trim(v_d ->> 'name'), 160), ''), 'Produto não identificado'),
      nullif(left(trim(v_d ->> 'brand'), 80), ''),
      nullif(left(trim(v_d ->> 'details'), 200), ''),
      v_qty, round(v_conf, 2), v_hidden,
      coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(v_d -> 'photos', '[]'::jsonb)) x
                 where x ~ '^\d+$'), '{}'),
      (select current_qty from public.household_products where id = v_pid),
      v_qty,
      -- Só entra confirmado automaticamente o que é seguro: produto conhecido,
      -- quantidade contada, alta confiança e totalmente visível.
      case when v_pid is not null and v_qty is not null and v_conf >= 0.8 and not v_hidden
           then 'confirmed' else 'pending' end::public.inventory_item_status
    );
    v_count := v_count + 1;
  end loop;

  -- Produtos esperados neste ambiente que não apareceram em nenhuma foto.
  if v_s.location_id is not null then
    insert into public.inventory_scan_items (scan_id, household_id, origin, household_product_id, system_quantity, status)
    select p_scan_id, v_s.household_id, 'expected', hp.id, hp.current_qty, 'pending'
      from public.household_products hp
     where hp.household_id = v_s.household_id
       and hp.location_id = v_s.location_id
       and hp.archived_at is null
       and not exists (
         select 1 from public.inventory_scan_items i
          where i.scan_id = p_scan_id and i.household_product_id = hp.id
       );
  end if;

  update public.inventory_scans set analyzed_at = now(), model = left(p_model, 80) where id = p_scan_id;
  return v_count;
end;
$$;

create or replace function public.update_inventory_item(
  p_item_id uuid,
  p_household_product_id uuid,
  p_confirmed_quantity numeric,
  p_status public.inventory_item_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_scan_items%rowtype;
begin
  select * into v_item from public.inventory_scan_items where id = p_item_id;
  if not found then
    raise exception 'Item não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_draft_scan(v_item.scan_id);
  if p_confirmed_quantity is not null and p_confirmed_quantity < 0 then
    raise exception 'Quantidade inválida' using errcode = '22023';
  end if;
  if p_household_product_id is not null then
    perform private.assert_same_household(v_item.household_id,
      coalesce((select household_id from public.household_products where id = p_household_product_id and archived_at is null),
               gen_random_uuid()),
      'Produto', false);
  end if;
  if p_status = 'confirmed' and (p_household_product_id is null or p_confirmed_quantity is null) then
    raise exception 'Para confirmar, escolha o produto e informe a quantidade' using errcode = '22023';
  end if;

  update public.inventory_scan_items
     set household_product_id = p_household_product_id,
         confirmed_quantity = p_confirmed_quantity,
         status = p_status,
         system_quantity = (select current_qty from public.household_products where id = p_household_product_id)
   where id = p_item_id;
end;
$$;

-- Confirma a conferência: cada produto confirmado recebe um ajuste de inventário
-- para a quantidade contada (somando, se o mesmo produto aparecer em mais de um item).
create or replace function public.confirm_inventory_scan(p_scan_id uuid)
returns table (adjusted_items int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_auth();
  v_s     public.inventory_scans%rowtype;
  v_row   record;
  v_count int := 0;
  v_key   text;
begin
  select * into v_s from public.inventory_scans where id = p_scan_id for update;
  if not found or not private.can_edit(v_s.household_id) then
    raise exception 'Conferência não encontrada' using errcode = 'P0002';
  end if;
  if v_s.status = 'confirmed' then
    return query select 0;
    return;
  end if;
  if v_s.status <> 'draft' then
    raise exception 'Esta conferência foi descartada' using errcode = '22023';
  end if;

  for v_row in
    select i.household_product_id as pid, sum(i.confirmed_quantity) as qty, hp.current_qty
      from public.inventory_scan_items i
      join public.household_products hp on hp.id = i.household_product_id and hp.archived_at is null
     where i.scan_id = p_scan_id and i.status = 'confirmed'
       and i.household_product_id is not null and i.confirmed_quantity is not null
     group by i.household_product_id, hp.current_qty
  loop
    if v_row.qty <> v_row.current_qty then
      perform private.apply_stock_movement(
        v_row.pid, 'inventory_adjustment', v_row.qty - v_row.current_qty, 'inventory_scan', p_scan_id,
        'Conferência por fotos', 'scan:' || p_scan_id::text || ':' || v_row.pid::text);
      v_count := v_count + 1;
    else
      -- Mesmo sem diferença, registra que o item foi conferido.
      update public.household_products set last_movement_at = now() where id = v_row.pid;
    end if;
  end loop;

  -- Aprende como a IA chama cada produto, para associar sozinho da próxima vez.
  for v_row in
    select distinct i.household_product_id as pid, private.normalize_text(concat_ws(' ', i.detected_name, i.detected_brand)) as key
      from public.inventory_scan_items i
     where i.scan_id = p_scan_id and i.status = 'confirmed' and i.origin = 'detected'
       and i.household_product_id is not null and i.detected_name is not null
  loop
    v_key := left(v_row.key, 200);
    if v_key is not null then
      insert into public.product_aliases (household_id, household_product_id, kind, key, store_cnpj)
      values (v_s.household_id, v_row.pid, 'description', v_key, '__scan__')
      on conflict (household_id, kind, key, store_cnpj)
      do update set household_product_id = excluded.household_product_id,
                    times_used = public.product_aliases.times_used + 1;
    end if;
  end loop;

  update public.inventory_scans set status = 'confirmed', confirmed_at = now(), confirmed_by = v_uid where id = p_scan_id;
  perform private.audit(v_s.household_id, 'inventory_scan.confirmed', 'inventory_scan', p_scan_id::text,
                        jsonb_build_object('adjusted_items', v_count));
  return query select v_count;
end;
$$;

create or replace function public.discard_inventory_scan(p_scan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_draft_scan(p_scan_id);
  update public.inventory_scans set status = 'discarded' where id = p_scan_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------
revoke execute on function private.require_draft_scan(uuid) from public, anon, authenticated;

revoke execute on function
  public.create_inventory_scan(uuid, uuid),
  public.register_inventory_photo(uuid, int, text, text, int, text),
  public.save_inventory_detections(uuid, jsonb, text),
  public.update_inventory_item(uuid, uuid, numeric, public.inventory_item_status),
  public.confirm_inventory_scan(uuid),
  public.discard_inventory_scan(uuid)
from public, anon;

grant execute on function
  public.create_inventory_scan(uuid, uuid),
  public.register_inventory_photo(uuid, int, text, text, int, text),
  public.save_inventory_detections(uuid, jsonb, text),
  public.update_inventory_item(uuid, uuid, numeric, public.inventory_item_status),
  public.confirm_inventory_scan(uuid),
  public.discard_inventory_scan(uuid)
to authenticated;
