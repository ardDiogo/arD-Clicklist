-- =============================================================================
-- FASE 4 — Compras e comprovantes (NFC-e QR Code, XML, foto com IA)
-- =============================================================================
-- Regras:
--   * Ler um comprovante cria um RASCUNHO (draft). O estoque não muda.
--   * Só a confirmação explícita gera entradas no estoque, numa única transação,
--     de forma idempotente (confirmar de novo não duplica).
--   * O mesmo comprovante (chave de acesso ou hash do arquivo) não vira duas
--     compras: importar de novo devolve a compra existente.
--   * Preços históricos ficam nos itens confirmados e nunca são sobrescritos.
--   * A família "ensina" o app: ao confirmar, a descrição do cupom e o EAN viram
--     apelidos (product_aliases) usados para associar automaticamente da próxima vez.
-- =============================================================================

create type public.purchase_status as enum ('draft', 'confirmed', 'discarded');
create type public.purchase_source as enum ('nfce_qrcode', 'xml', 'photo', 'manual');

-- -----------------------------------------------------------------------------
-- Normalização de texto para associação ("KETCHUP BON. ZERO 380G" → "ketchup bon zero 380g")
-- -----------------------------------------------------------------------------
create or replace function private.normalize_text(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(trim(regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g')), '');
$$;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------
create table public.purchases (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  status           public.purchase_status not null default 'draft',
  source           public.purchase_source not null,
  store_name       text check (store_name is null or char_length(store_name) <= 160),
  store_cnpj       text check (store_cnpj is null or store_cnpj ~ '^[0-9]{14}$'),
  purchased_at     timestamptz,
  access_key       text check (access_key is null or access_key ~ '^[0-9]{44}$'),
  file_sha256      text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  source_url       text check (source_url is null or char_length(source_url) <= 2000),
  total_amount     numeric(12, 2) check (total_amount is null or total_amount >= 0),
  discount_amount  numeric(12, 2) check (discount_amount is null or discount_amount >= 0),
  raw_extraction   jsonb not null default '{}'::jsonb,
  notes            text check (notes is null or char_length(notes) <= 500),
  created_by       uuid references auth.users (id) on delete set null,
  confirmed_by     uuid references auth.users (id) on delete set null,
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index purchases_unique_access_key
  on public.purchases (household_id, access_key) where access_key is not null and status <> 'discarded';
create unique index purchases_unique_file
  on public.purchases (household_id, file_sha256) where file_sha256 is not null and status <> 'discarded';
create index purchases_household_idx on public.purchases (household_id, coalesce(purchased_at, created_at) desc);

create trigger purchases_updated_at before update on public.purchases
  for each row execute function private.set_updated_at();
create trigger purchases_immutable_household before update on public.purchases
  for each row execute function private.prevent_household_change();

create table public.purchase_files (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  purchase_id   uuid references public.purchases (id) on delete set null,
  storage_path  text not null unique,
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/xml', 'text/xml')),
  size_bytes    int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index purchase_files_purchase_idx on public.purchase_files (purchase_id);

create table public.purchase_items (
  id                    uuid primary key default gen_random_uuid(),
  purchase_id           uuid not null references public.purchases (id) on delete cascade,
  household_id          uuid not null references public.households (id) on delete cascade,
  line_number           int not null,
  description           text not null check (char_length(description) between 1 and 200),
  ean                   text check (ean is null or ean ~ '^[0-9]{8,14}$'),
  quantity              numeric(12, 3) not null check (quantity > 0),
  unit                  text check (unit is null or char_length(unit) <= 10),
  unit_price            numeric(12, 4) check (unit_price is null or unit_price >= 0),
  discount              numeric(12, 2) not null default 0 check (discount >= 0),
  total_price           numeric(12, 2) not null check (total_price >= 0),
  household_product_id  uuid references public.household_products (id) on delete set null,
  match_source          text check (match_source in ('alias_ean', 'barcode', 'alias_description', 'user')),
  received              boolean not null default true,
  ignored               boolean not null default false,
  stock_quantity        numeric(12, 3) not null default 1 check (stock_quantity >= 0),
  -- Custo por embalagem de estoque, gravado na confirmação (base do histórico de preços).
  unit_cost             numeric(12, 4) check (unit_cost is null or unit_cost >= 0),
  hint                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (purchase_id, line_number)
);

create index purchase_items_product_idx on public.purchase_items (household_product_id);

create trigger purchase_items_updated_at before update on public.purchase_items
  for each row execute function private.set_updated_at();

create table public.product_aliases (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households (id) on delete cascade,
  household_product_id  uuid not null references public.household_products (id) on delete cascade,
  kind                  text not null check (kind in ('ean', 'description')),
  key                   text not null check (char_length(key) between 1 and 200),
  store_cnpj            text not null default '',
  times_used            int not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (household_id, kind, key, store_cnpj)
);

create trigger product_aliases_updated_at before update on public.product_aliases
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS (leitura para membros; escrita via RPC)
-- -----------------------------------------------------------------------------
alter table public.purchases       enable row level security;
alter table public.purchase_files  enable row level security;
alter table public.purchase_items  enable row level security;
alter table public.product_aliases enable row level security;

create policy purchases_select on public.purchases for select to authenticated using (private.is_member(household_id));
create policy purchase_files_select on public.purchase_files for select to authenticated using (private.is_member(household_id));
create policy purchase_items_select on public.purchase_items for select to authenticated using (private.is_member(household_id));
create policy product_aliases_select on public.product_aliases for select to authenticated using (private.is_member(household_id));

revoke all on public.purchases, public.purchase_files, public.purchase_items, public.product_aliases from anon, authenticated;
grant select on public.purchases, public.purchase_files, public.purchase_items, public.product_aliases to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: bucket privado "receipts", pasta = household_id
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/xml', 'text/xml'])
on conflict (id) do nothing;

-- Compara como texto para que nomes de pasta inválidos resultem em "negado", não em erro.
create or replace function private.storage_household_access(p_object_name text, p_need_edit boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
     where m.user_id = auth.uid()
       and m.household_id::text = split_part(p_object_name, '/', 1)
       and (not p_need_edit or m.role in ('admin', 'editor'))
  );
$$;

grant execute on function private.storage_household_access(text, boolean) to authenticated;

create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and private.storage_household_access(name, false));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and private.storage_household_access(name, true));

-- -----------------------------------------------------------------------------
-- Histórico de preços (somente compras confirmadas)
-- -----------------------------------------------------------------------------
create view public.product_price_history
with (security_invoker = true)
as
select
  i.id,
  i.household_id,
  i.household_product_id,
  p.id            as purchase_id,
  p.store_name,
  p.store_cnpj,
  coalesce(p.purchased_at, p.confirmed_at) as purchased_at,
  i.description,
  i.quantity,
  i.unit,
  i.unit_price,
  i.discount,
  i.total_price,
  i.stock_quantity,
  i.unit_cost
from public.purchase_items i
join public.purchases p on p.id = i.purchase_id
where p.status = 'confirmed'
  and i.household_product_id is not null
  and i.unit_cost is not null;

grant select on public.product_price_history to authenticated;

create view public.household_product_prices
with (security_invoker = true)
as
select
  household_product_id,
  household_id,
  count(*)::int                                                    as purchases,
  (array_agg(unit_cost order by purchased_at desc, id))[1]         as last_price,
  (array_agg(store_name order by purchased_at desc, id))[1]        as last_store,
  max(purchased_at)                                                as last_purchased_at,
  round(avg(unit_cost), 2)                                         as avg_price,
  min(unit_cost)                                                   as min_price,
  max(unit_cost)                                                   as max_price,
  (array_agg(unit_cost order by purchased_at desc, id))[2]         as previous_price
from public.product_price_history
group by household_product_id, household_id;

grant select on public.household_product_prices to authenticated;

create or replace function private.last_unit_cost(p_household_product_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(i.unit_cost, 2)
    from public.purchase_items i
    join public.purchases p on p.id = i.purchase_id
   where i.household_product_id = p_household_product_id
     and p.status = 'confirmed'
     and i.unit_cost is not null
   order by coalesce(p.purchased_at, p.confirmed_at) desc, i.id
   limit 1;
$$;

-- Lista de compras: itens novos já nascem com o último preço pago (estimativa).
create or replace function private.shopping_item_default_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estimated_unit_price is null and new.household_product_id is not null then
    new.estimated_unit_price := private.last_unit_cost(new.household_product_id);
  end if;
  return new;
end;
$$;

create trigger shopping_list_items_default_price before insert on public.shopping_list_items
  for each row execute function private.shopping_item_default_price();

-- -----------------------------------------------------------------------------
-- Associação automática de um item do cupom a um produto da família
-- -----------------------------------------------------------------------------
create or replace function private.match_purchase_item(
  p_household_id uuid,
  p_store_cnpj text,
  p_ean text,
  p_description text,
  out household_product_id uuid,
  out match_source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := private.normalize_text(p_description);
begin
  if p_ean is not null then
    select a.household_product_id into household_product_id
      from public.product_aliases a
      join public.household_products hp on hp.id = a.household_product_id and hp.archived_at is null
     where a.household_id = p_household_id and a.kind = 'ean' and a.key = p_ean
     order by a.times_used desc limit 1;
    if household_product_id is not null then match_source := 'alias_ean'; return; end if;

    select hp.id into household_product_id
      from public.household_products hp
      join public.products p on p.id = hp.product_id
     where hp.household_id = p_household_id and hp.archived_at is null and p.barcode = p_ean
     limit 1;
    if household_product_id is not null then match_source := 'barcode'; return; end if;
  end if;

  if v_key is not null then
    select a.household_product_id into household_product_id
      from public.product_aliases a
      join public.household_products hp on hp.id = a.household_product_id and hp.archived_at is null
     where a.household_id = p_household_id and a.kind = 'description' and a.key = v_key
     order by (a.store_cnpj = coalesce(p_store_cnpj, '')) desc, a.times_used desc
     limit 1;
    if household_product_id is not null then match_source := 'alias_description'; return; end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Registra um arquivo já enviado ao Storage (pasta da família).
create or replace function public.register_purchase_file(
  p_household_id uuid,
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
  v_uid uuid := private.require_auth();
  v_id  uuid;
begin
  if not private.can_edit(p_household_id) then
    raise exception 'Você não tem permissão para importar compras' using errcode = '42501';
  end if;
  if split_part(p_storage_path, '/', 1) <> p_household_id::text or p_storage_path like '%..%' then
    raise exception 'Caminho de arquivo inválido' using errcode = '22023';
  end if;
  insert into public.purchase_files (household_id, storage_path, mime_type, size_bytes, sha256, created_by)
  values (p_household_id, p_storage_path, p_mime_type, p_size_bytes, lower(p_sha256), v_uid)
  on conflict (storage_path) do update set storage_path = excluded.storage_path
  returning id into v_id;
  return v_id;
end;
$$;

-- Cria o rascunho da compra a partir dos dados extraídos (QR/XML/IA).
-- p_data: { store_name, store_cnpj, purchased_at, access_key, total, discount, source_url,
--           items: [{ description, ean, quantity, unit, unit_price, discount, total }] }
-- Se o mesmo comprovante já foi importado, devolve a compra existente.
create or replace function public.create_purchase_draft(
  p_household_id uuid,
  p_source public.purchase_source,
  p_data jsonb,
  p_file_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := private.require_auth();
  v_id        uuid;
  v_key       text := nullif(regexp_replace(coalesce(p_data ->> 'access_key', ''), '\D', '', 'g'), '');
  v_cnpj      text := nullif(regexp_replace(coalesce(p_data ->> 'store_cnpj', ''), '\D', '', 'g'), '');
  v_sha       text;
  v_item      jsonb;
  v_line      int := 0;
  v_match     record;
  v_qty       numeric;
  v_total     numeric;
  v_unit      text;
  v_ean       text;
  v_hint      text;
  v_received  boolean;
begin
  if not private.can_edit(p_household_id) then
    raise exception 'Você não tem permissão para importar compras' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data -> 'items') <> 'array' or jsonb_array_length(p_data -> 'items') = 0 then
    raise exception 'Nenhum item encontrado no comprovante' using errcode = '22023';
  end if;
  if jsonb_array_length(p_data -> 'items') > 300 then
    raise exception 'Comprovante com itens demais' using errcode = '22023';
  end if;
  if v_key is not null and length(v_key) <> 44 then
    v_key := null;
  end if;
  if v_cnpj is not null and length(v_cnpj) <> 14 then
    v_cnpj := null;
  end if;

  if p_file_id is not null then
    select sha256 into v_sha from public.purchase_files where id = p_file_id and household_id = p_household_id;
    if v_sha is null then
      raise exception 'Arquivo não encontrado' using errcode = 'P0002';
    end if;
  end if;

  -- Idempotência: mesmo comprovante já importado (e não descartado).
  select id into v_id from public.purchases
   where household_id = p_household_id and status <> 'discarded'
     and ((v_key is not null and access_key = v_key) or (v_sha is not null and file_sha256 = v_sha))
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.purchases (
    household_id, source, store_name, store_cnpj, purchased_at, access_key, file_sha256, source_url,
    total_amount, discount_amount, raw_extraction, created_by
  ) values (
    p_household_id, p_source,
    nullif(left(trim(p_data ->> 'store_name'), 160), ''),
    v_cnpj,
    nullif(p_data ->> 'purchased_at', '')::timestamptz,
    v_key, v_sha,
    nullif(left(p_data ->> 'source_url', 2000), ''),
    nullif(p_data ->> 'total', '')::numeric,
    nullif(p_data ->> 'discount', '')::numeric,
    p_data, v_uid
  )
  returning id into v_id;

  if p_file_id is not null then
    update public.purchase_files set purchase_id = v_id where id = p_file_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_data -> 'items')
  loop
    v_line := v_line + 1;
    v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1);
    if v_qty <= 0 then v_qty := 1; end if;
    v_total := coalesce(nullif(v_item ->> 'total', '')::numeric,
                        round(v_qty * coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0), 2));
    v_unit := upper(nullif(left(trim(v_item ->> 'unit'), 10), ''));
    v_ean := nullif(regexp_replace(coalesce(v_item ->> 'ean', ''), '\D', '', 'g'), '');
    if v_ean is not null and (length(v_ean) < 8 or v_ean ~ '^0+$') then v_ean := null; end if;

    select * into v_match from private.match_purchase_item(p_household_id, v_cnpj, v_ean, v_item ->> 'description');

    -- Se este produto já entrou no estoque por uma lista finalizada nos últimos
    -- 3 dias, provavelmente é a mesma compra: sugere não lançar de novo.
    v_hint := null;
    v_received := true;
    if v_match.household_product_id is not null and exists (
      select 1 from public.stock_movements m
       join public.shopping_lists sl on sl.id = m.source_id
      where m.household_product_id = v_match.household_product_id
        and m.type = 'purchase' and m.created_at > now() - interval '3 days'
    ) then
      v_hint := 'Já lançado no estoque por uma lista finalizada recentemente';
      v_received := false;
    end if;

    insert into public.purchase_items (
      purchase_id, household_id, line_number, description, ean, quantity, unit, unit_price, discount,
      total_price, household_product_id, match_source, received, stock_quantity, hint
    ) values (
      v_id, p_household_id, v_line,
      left(coalesce(nullif(trim(v_item ->> 'description'), ''), 'Item ' || v_line), 200),
      v_ean, v_qty, v_unit,
      nullif(v_item ->> 'unit_price', '')::numeric,
      greatest(0, coalesce(nullif(v_item ->> 'discount', '')::numeric, 0)),
      greatest(0, v_total),
      v_match.household_product_id, v_match.match_source, v_received,
      -- Itens vendidos por peso/volume entram como 1 embalagem; os demais pela quantidade.
      case when v_unit in ('KG', 'G', 'L', 'ML', 'LT', 'GR') then 1 else greatest(1, round(v_qty)) end,
      v_hint
    );
  end loop;

  perform private.audit(p_household_id, 'purchase.draft_created', 'purchase', v_id::text,
                        jsonb_build_object('source', p_source, 'items', v_line));
  return v_id;
end;
$$;

create or replace function private.require_draft_purchase(p_purchase_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.purchases%rowtype;
begin
  perform private.require_auth();
  select * into v_p from public.purchases where id = p_purchase_id for update;
  if not found or not private.can_edit(v_p.household_id) then
    raise exception 'Compra não encontrada' using errcode = 'P0002';
  end if;
  if v_p.status <> 'draft' then
    raise exception 'Esta compra já foi % e não pode ser alterada',
      case v_p.status when 'confirmed' then 'confirmada' else 'descartada' end using errcode = '22023';
  end if;
  return v_p;
end;
$$;

-- Ajusta um item na revisão (associação, recebido, quantidade para o estoque).
create or replace function public.update_purchase_item(
  p_item_id uuid,
  p_household_product_id uuid,
  p_received boolean,
  p_ignored boolean,
  p_stock_quantity numeric
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
  if coalesce(p_stock_quantity, 0) < 0 then
    raise exception 'Quantidade inválida' using errcode = '22023';
  end if;
  if p_household_product_id is not null then
    perform private.assert_same_household(v_item.household_id,
      coalesce((select household_id from public.household_products
                 where id = p_household_product_id and archived_at is null), gen_random_uuid()),
      'Produto', false);
  end if;

  update public.purchase_items
     set household_product_id = p_household_product_id,
         match_source = case
           when p_household_product_id is null then null
           when p_household_product_id is distinct from household_product_id then 'user'
           else match_source end,
         received = coalesce(p_received, received),
         ignored = coalesce(p_ignored, ignored),
         stock_quantity = coalesce(p_stock_quantity, stock_quantity)
   where id = p_item_id;
end;
$$;

create or replace function public.update_purchase_header(
  p_purchase_id uuid,
  p_store_name text,
  p_purchased_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_draft_purchase(p_purchase_id);
  update public.purchases
     set store_name = nullif(left(trim(p_store_name), 160), ''),
         purchased_at = p_purchased_at
   where id = p_purchase_id;
end;
$$;

-- Confirma a compra: entradas de estoque + preços + aprendizado, tudo ou nada.
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
        left('Compra: ' || coalesce(v_p.store_name, 'comprovante'), 500), 'purchase-item:' || v_item.id::text);
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

create or replace function public.discard_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.purchases%rowtype;
begin
  v_p := private.require_draft_purchase(p_purchase_id);
  update public.purchases set status = 'discarded' where id = p_purchase_id;
  perform private.audit(v_p.household_id, 'purchase.discarded', 'purchase', p_purchase_id::text);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------
revoke execute on function
  private.normalize_text(text),
  private.last_unit_cost(uuid),
  private.shopping_item_default_price(),
  private.match_purchase_item(uuid, text, text, text),
  private.require_draft_purchase(uuid)
from public, anon, authenticated;

revoke execute on function
  public.register_purchase_file(uuid, text, text, int, text),
  public.create_purchase_draft(uuid, public.purchase_source, jsonb, uuid),
  public.update_purchase_item(uuid, uuid, boolean, boolean, numeric),
  public.update_purchase_header(uuid, text, timestamptz),
  public.confirm_purchase(uuid),
  public.discard_purchase(uuid)
from public, anon;

grant execute on function
  public.register_purchase_file(uuid, text, text, int, text),
  public.create_purchase_draft(uuid, public.purchase_source, jsonb, uuid),
  public.update_purchase_item(uuid, uuid, boolean, boolean, numeric),
  public.update_purchase_header(uuid, text, timestamptz),
  public.confirm_purchase(uuid),
  public.discard_purchase(uuid)
to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.purchases, public.purchase_items;
  end if;
end;
$$;
