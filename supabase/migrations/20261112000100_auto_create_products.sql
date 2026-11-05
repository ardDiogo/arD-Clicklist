-- =============================================================================
-- Cadastro automático de produtos ao confirmar uma compra
-- =============================================================================
-- Ao confirmar, cada item do comprovante que não foi associado a um produto e não
-- foi marcado como "ignorar" vira um produto novo da família:
--   * nome legível a partir da descrição ("FLV MACA GALA KG" → "Maca Gala");
--   * embalagem extraída da descrição quando possível ("500ML" → 500 ml);
--   * categoria sugerida por palavras-chave (pode ser corrigida depois);
--   * código de barras do cupom, quando houver;
--   * "quanto manter" = quantidade comprada (ajustável).
-- Linhas repetidas com a mesma descrição geram um único produto.
-- A criação acontece na confirmação (não na leitura): rascunhos descartados não
-- deixam produtos órfãos. O apelido aprendido faz a próxima compra associar sozinha.
-- =============================================================================

alter table public.purchase_items drop constraint if exists purchase_items_match_source_check;
alter table public.purchase_items add constraint purchase_items_match_source_check
  check (match_source in ('alias_ean', 'barcode', 'alias_description', 'user', 'auto'));

-- Categoria sugerida pela descrição do cupom.
create or replace function private.guess_category_name(p_description text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d ~ '^(flv|hort|frut)\M'
      then 'Hortifruti'
    when d ~ '\m(agua mineral|suco|refrig|refri|cerveja|vinho|cafe soluvel|caps|capsula|energet|isoton)'
      then 'Bebidas'
    when d ~ '\m(banana|maca|pera|uva|laranja|limao|tomate|cebola|batata inglesa|alface|cenoura|melancia|mamao|abacaxi|ameixa|cebolinha|salsa|alho poro|ovo|ovos)\M'
      then 'Hortifruti'
    when d ~ '\m(sabon|sabonete|desod|shamp|condic|cr dent|creme dental|esc dent|escova|fio dent|hid labial|absorv|fralda|papel hig|barbead|hidrat)'
      then 'Higiene pessoal'
    when d ~ '\m(amac|sabao|lava roupa|alvejante|tira manchas)'
      then 'Lavanderia'
    when d ~ '\m(deterg|lava louca|agua sanit|desinf|esponja|saponaceo|limp|multiuso|la aco|bombril|pano|vassoura|rodo|inset|lustra)'
      then 'Limpeza'
    when d ~ '\m(saco lixo|guardanapo|papel toalha|copo desc|prato desc|filtro|papel alum|filme pvc|palito)'
      then 'Descartáveis'
    when d ~ '\m(agua mineral|suco|refrig|refri|cerveja|vinho|cha |cafe soluvel|caps|capsula|energet|isoton|leite fermentado)'
      then 'Bebidas'
    when d ~ '\m(queijo|presunto|mortadela|salame|bacon|carne|frango|file|filezinho|linguica|salsicha|peito|coxa|sobrecoxa|costela|patinho|acem|alcatra|picanha|peixe|tilapia|hamburguer|req|requeijao|manteiga|iogurte)'
      then 'Carnes e frios'
    when d ~ '\m(carvao|pilha|lampada|vela)'
      then 'Outros'
    else 'Mercearia'
  end
  from (select private.normalize_text(p_description) as d) x;
$$;

-- Embalagem a partir da descrição: "500ML" → (500, ml) · "1,350L" → (1.35, l) · "5KG" → (5, kg).
create or replace function private.parse_package(p_description text, out size numeric, out unit public.measure_unit)
language plpgsql
immutable
set search_path = ''
as $$
declare
  m text[];
begin
  m := regexp_match(upper(coalesce(p_description, '')), '(\d+(?:[.,]\d+)?)\s*(KG|ML|LT|L|GR|G)\M');
  if m is null then
    return;
  end if;
  size := replace(m[1], ',', '.')::numeric;
  unit := case m[2] when 'KG' then 'kg' when 'ML' then 'ml' when 'LT' then 'l' when 'L' then 'l' else 'g' end;
  if size <= 0 then size := null; unit := null; end if;
end;
$$;

-- Nome legível: tira prefixo de hortifruti, embalagem e "KG" de granel.
create or replace function private.product_name_from_description(p_description text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(nullif(initcap(lower(trim(regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p_description, ''), '^\s*(FLV|HORT)\s+', '', 'i'),
             '\s*\d+(?:[.,]\d+)?\s*(KG|ML|LT|L|GR|G)\M', '', 'gi'),
           '\s+(KG|GRANEL)\s*$', '', 'i')))), ''), trim(p_description)), 120);
$$;

create or replace function private.auto_create_purchase_products(p_purchase_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.purchases%rowtype;
  v_row   record;
  v_pkg   record;
  v_hp    uuid;
  v_count int := 0;
  v_ean   text;
begin
  select * into v_p from public.purchases where id = p_purchase_id;

  for v_row in
    select private.normalize_text(description) as key,
           min(description) as description,
           max(ean) as ean,
           max(unit) as receipt_unit,
           sum(case when received then stock_quantity else 0 end) as qty_received,
           sum(stock_quantity) as qty
      from public.purchase_items
     where purchase_id = p_purchase_id and household_product_id is null and not ignored
     group by 1
  loop
    -- Pode ter sido associado por EAN/apelido depois da leitura (ex.: outra compra confirmada antes).
    select m.household_product_id into v_hp
      from private.match_purchase_item(v_p.household_id, v_p.store_cnpj, v_row.ean, v_row.description) m;

    if v_hp is null then
      select * into v_pkg from private.parse_package(v_row.description);
      -- Itens a granel (vendidos por kg) não têm embalagem fixa.
      if v_row.receipt_unit in ('KG', 'G', 'GR') and v_pkg.unit in ('kg', 'g') and coalesce(v_pkg.size, 0) < 1 then
        v_pkg := null;
      end if;
      v_ean := v_row.ean;
      if v_ean is not null and exists (
        select 1 from public.products where household_id = v_p.household_id and barcode = v_ean and deleted_at is null
      ) then
        v_ean := null;
      end if;

      v_hp := public.create_tracked_product(
        v_p.household_id,
        private.product_name_from_description(v_row.description),
        null,
        (select id from public.categories
          where household_id is null and archived_at is null
            and name = private.guess_category_name(v_row.description)),
        case when v_row.receipt_unit in ('KG', 'G', 'GR') then 'Granel (kg)' end,
        case when v_row.receipt_unit in ('KG', 'G', 'GR') then null else v_pkg.size end,
        coalesce(case when v_row.receipt_unit in ('KG', 'G', 'GR') then null else v_pkg.unit end, 'un'),
        v_ean,
        null,
        greatest(1, v_row.qty),
        0,
        'Cadastrado automaticamente a partir do cupom: ' || left(v_row.description, 200));
      v_count := v_count + 1;
    end if;

    update public.purchase_items
       set household_product_id = v_hp,
           match_source = 'auto'
     where purchase_id = p_purchase_id and household_product_id is null and not ignored
       and private.normalize_text(description) is not distinct from v_row.key;
  end loop;

  return v_count;
end;
$$;

revoke execute on function
  private.guess_category_name(text),
  private.parse_package(text),
  private.product_name_from_description(text),
  private.auto_create_purchase_products(uuid)
from public, anon, authenticated;

-- confirm_purchase: igual à versão anterior, chamando o cadastro automático antes de lançar.
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
