-- =============================================================================
-- Produtos genéricos: reconhecer pelo nome (independe da marca) e juntar duplicados
-- =============================================================================
-- O produto do estoque é o item genérico ("Pão de forma"); a marca e a descrição
-- exata ficam em cada item de compra (referência de preço). Assim a lista mostra
-- um item só, qualquer que seja a marca comprada.
--
-- 1) private.match_purchase_item ganha uma 4ª etapa ("name"): se as palavras do
--    nome do produto aparecem na descrição do cupom (aceitando abreviações:
--    "OVO VERM" → "Ovos vermelhos", "REQ CREM" → "Requeijão cremoso"), o item é
--    ligado a ele. A 1ª palavra do nome precisa bater com a 1ª da descrição
--    (evita "PAO FORMA ... LEITE" cair em "Leite"). Vence o nome mais específico.
-- 2) public.merge_household_products junta um duplicado em outro produto:
--    estoque, compras (histórico de preços), apelidos, listas e conferências.
-- =============================================================================

alter table public.purchase_items drop constraint if exists purchase_items_match_source_check;
alter table public.purchase_items add constraint purchase_items_match_source_check
  check (match_source in ('alias_ean', 'barcode', 'alias_description', 'user', 'auto', 'name'));

-- Palavras significativas de um texto (sem acentos, sem números/medidas, sem conectivos).
create or replace function private.name_tokens(p text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t order by ord), '{}')
    from unnest(string_to_array(coalesce(private.normalize_text(p), ''), ' ')) with ordinality as x(t, ord)
   where t <> ''
     and t !~ '\d'
     and char_length(t) >= 2
     and t not in ('de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'em', 'para', 'p', 'c', 'e', 'a', 'o',
                   'un', 'und', 'unid', 'kg', 'g', 'gr', 'ml', 'l', 'lt', 'cx', 'pct', 'pc', 'fd', 'bdj', 'emb');
$$;

-- Liga a descrição do cupom a um produto pelo nome. Null se nenhum combinar.
create or replace function private.match_product_by_name(p_household_id uuid, p_description text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desc text[] := private.name_tokens(p_description);
  v_id   uuid;
begin
  -- Prefixos de seção do cupom não fazem parte do nome (FLV = hortifruti).
  while array_length(v_desc, 1) > 1 and v_desc[1] in ('flv', 'hort', 'hf') loop
    v_desc := v_desc[2:];
  end loop;
  if coalesce(array_length(v_desc, 1), 0) = 0 then return null; end if;

  select c.id into v_id
    from (
      select hp.id, hp.created_at, private.name_tokens(p.name) as tk
        from public.household_products hp
        join public.products p on p.id = hp.product_id
       where hp.household_id = p_household_id and hp.archived_at is null
    ) c
   where coalesce(array_length(c.tk, 1), 0) > 0
     -- 1ª palavra do nome = 1ª da descrição (igual, ou abreviação com 3+ letras)
     and (c.tk[1] = v_desc[1] or (char_length(v_desc[1]) >= 3 and c.tk[1] like v_desc[1] || '%'))
     -- todas as palavras do nome aparecem na descrição (iguais ou abreviadas)
     and not exists (
       select 1 from unnest(c.tk) t
        where not exists (
          select 1 from unnest(v_desc) d
           where d = t or (char_length(d) >= 3 and t like d || '%')
        )
     )
   order by array_length(c.tk, 1) desc, c.created_at
   limit 1;
  return v_id;
end;
$$;

-- Associação automática: código → apelido de descrição → NOME (nova etapa).
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

  household_product_id := private.match_product_by_name(p_household_id, p_description);
  if household_product_id is not null then match_source := 'name'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Juntar produtos: o "de" (duplicado) passa a fazer parte do "para" (que fica).
-- -----------------------------------------------------------------------------
create or replace function public.merge_household_products(p_from uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.household_products%rowtype;
  v_into public.household_products%rowtype;
  v_from_name text;
  v_into_name text;
begin
  perform private.require_auth();
  if p_from = p_into then
    raise exception 'Escolha um produto diferente' using errcode = '22023';
  end if;
  select * into v_from from public.household_products where id = p_from and archived_at is null for update;
  select * into v_into from public.household_products where id = p_into and archived_at is null for update;
  if v_from.id is null or v_into.id is null or v_from.household_id <> v_into.household_id
     or not private.can_edit(v_from.household_id) then
    raise exception 'Produto não encontrado' using errcode = 'P0002';
  end if;
  select name into v_from_name from public.products where id = v_from.product_id;
  select name into v_into_name from public.products where id = v_into.product_id;

  -- Estoque: o que havia no duplicado soma no produto que fica.
  if v_from.current_qty > 0 then
    perform private.apply_stock_movement(p_from, 'correction', -v_from.current_qty, 'manual', p_into,
      left('Juntado com "' || v_into_name || '"', 500), 'merge:' || p_from::text || ':out');
    perform private.apply_stock_movement(p_into, 'correction', v_from.current_qty, 'manual', p_from,
      left('Vindo de "' || v_from_name || '" (produtos juntados)', 500), 'merge:' || p_from::text || ':in');
  end if;

  -- Compras e histórico de preços.
  update public.purchase_items set household_product_id = p_into where household_product_id = p_from;
  -- Apelidos aprendidos (códigos e descrições do cupom) passam a apontar para o que fica.
  update public.product_aliases set household_product_id = p_into where household_product_id = p_from;

  -- Listas: se as duas estão na mesma lista, soma a quantidade; senão só troca o produto.
  update public.shopping_list_items t
     set quantity = t.quantity + f.quantity
    from public.shopping_list_items f
   where f.household_product_id = p_from and t.household_product_id = p_into
     and f.list_id = t.list_id and f.removed_at is null and t.removed_at is null;
  delete from public.shopping_list_items f
   where f.household_product_id = p_from
     and exists (select 1 from public.shopping_list_items t where t.list_id = f.list_id and t.household_product_id = p_into);
  update public.shopping_list_items set household_product_id = p_into where household_product_id = p_from;

  -- Conferências por foto.
  update public.inventory_scan_items set household_product_id = p_into where household_product_id = p_from;

  -- Quantidade ideal: mantém a do produto que fica (ou herda, se ele não tinha).
  update public.household_products
     set ideal_qty = case when ideal_qty = 0 then v_from.ideal_qty else ideal_qty end
   where id = p_into;
  update public.household_products set archived_at = now() where id = p_from;

  perform private.audit(v_from.household_id, 'product.merged', 'household_product', p_from::text,
                        jsonb_build_object('into', p_into, 'from_name', v_from_name, 'into_name', v_into_name,
                                           'moved_qty', v_from.current_qty));
end;
$$;

-- -----------------------------------------------------------------------------
-- Produtos parecidos: sugere juntar o mais específico no mais genérico
-- ("Pao Forma Seven Boys Leite 1un" → "Pão de forma"), ou nomes iguais (o mais
-- novo no mais antigo). Só sugere; quem decide é o usuário.
-- -----------------------------------------------------------------------------
create or replace function public.suggest_product_merges(p_household_id uuid)
returns table (from_id uuid, from_name text, from_qty numeric, into_id uuid, into_name text, into_qty numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_auth();
  if not private.is_member(p_household_id) then
    raise exception 'Família não encontrada' using errcode = '42501';
  end if;
  return query
  with c as (
    select hp.id, hp.created_at, hp.current_qty, p.name, private.name_tokens(p.name) as tk
      from public.household_products hp
      join public.products p on p.id = hp.product_id
     where hp.household_id = p_household_id and hp.archived_at is null
  ), pairs as (
    select b.id as b_id, b.name as b_name, b.current_qty as b_qty,
           a.id as a_id, a.name as a_name, a.current_qty as a_qty,
           array_length(a.tk, 1) as a_len, a.created_at as a_created
      from c b
      join c a on a.id <> b.id
     where coalesce(array_length(a.tk, 1), 0) > 0
       and array_length(a.tk, 1) <= array_length(b.tk, 1)
       -- mesmo nome: só sugere o mais novo → mais antigo
       and (array_length(a.tk, 1) < array_length(b.tk, 1) or a.created_at < b.created_at
            or (a.created_at = b.created_at and a.id < b.id))
       and (a.tk[1] = b.tk[1] or (char_length(b.tk[1]) >= 3 and a.tk[1] like b.tk[1] || '%')
                              or (char_length(a.tk[1]) >= 3 and b.tk[1] like a.tk[1] || '%'))
       and not exists (
         select 1 from unnest(a.tk) t
          where not exists (
            select 1 from unnest(b.tk) d
             where d = t or (char_length(d) >= 3 and t like d || '%') or (char_length(t) >= 3 and d like t || '%')
          )
       )
  )
  -- para cada produto específico, o genérico mais próximo (mais palavras em comum)
  select distinct on (pr.b_id) pr.b_id, pr.b_name, pr.b_qty, pr.a_id, pr.a_name, pr.a_qty
    from pairs pr
   -- não sugere juntar num produto que também vai ser juntado em outro
   where not exists (select 1 from pairs x where x.b_id = pr.a_id)
   order by pr.b_id, pr.a_len desc, pr.a_created;
end;
$$;

revoke execute on function public.suggest_product_merges(uuid) from public, anon;
grant execute on function public.suggest_product_merges(uuid) to authenticated;

revoke execute on function private.match_product_by_name(uuid, text) from public, anon, authenticated;
revoke execute on function public.merge_household_products(uuid, uuid) from public, anon;
grant execute on function public.merge_household_products(uuid, uuid) to authenticated;

-- Rascunhos já importados: tenta ligar pelo nome os itens que ficaram sem produto.
update public.purchase_items i
   set household_product_id = m.id, match_source = 'name'
  from (
    select pi.id as item_id, private.match_product_by_name(pi.household_id, pi.description) as id
      from public.purchase_items pi
      join public.purchases p on p.id = pi.purchase_id and p.status = 'draft'
     where pi.household_product_id is null and not pi.ignored
  ) m
 where i.id = m.item_id and m.id is not null;
