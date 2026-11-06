-- Testes: produto genérico (reconhecer pelo nome, independe da marca) e juntar duplicados.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select public.create_tracked_product(:'hh', 'Pão de forma', 'Seven Boys', null, null, 450, 'g', null, null, 2, 0) as pao \gset
select public.create_tracked_product(:'hh', 'Ovos vermelhos', 'Happy Eggs', null, null, null, 'un', null, null, 2, 0) as ovos \gset
select public.create_tracked_product(:'hh', 'Leite', 'Itambé', null, null, 1, 'l', null, null, 6, 0) as leite \gset
select public.create_tracked_product(:'hh', 'Requeijão cremoso', null, null, null, null, 'un', null, null, 1, 0) as req \gset
select public.create_tracked_product(:'hh', 'Água mineral com gás', 'Crystal', null, null, 500, 'ml', null, null, 36, 2) as agua \gset
select public.create_tracked_product(:'hh', 'Água sanitária', null, null, null, null, 'un', null, null, 1, 0) as sanit \gset
select public.create_tracked_product(:'hh', 'Sabonete', null, null, null, null, 'un', null, null, 4, 0) as sabonete \gset

-- Reconhecimento pelo nome, qualquer marca (função interna: roda como administrador)
reset role;
select tests.eq((select household_product_id from private.match_purchase_item(:'hh', null, null, 'PAO FORMA WICKBOLD 500G INTEGRAL')), :'pao'::uuid, 'pão de outra marca → Pão de forma');
select tests.eq((select match_source from private.match_purchase_item(:'hh', null, null, 'PAO FORMA WICKBOLD 500G INTEGRAL')), 'name', 'origem = nome');
select tests.eq((select household_product_id from private.match_purchase_item(:'hh', null, null, 'FLV OVO VERM HAPPY EGGS C/20')), :'ovos'::uuid, 'abreviação e prefixo FLV → Ovos vermelhos');
select tests.eq((select household_product_id from private.match_purchase_item(:'hh', null, null, 'REQ CREM ITAMBE 400G PT LIGHT')), :'req'::uuid, 'REQ CREM → Requeijão cremoso');
select tests.eq((select household_product_id from private.match_purchase_item(:'hh', null, null, 'LEITE LV UHT PIRACANJUBA 1L')), :'leite'::uuid, 'leite de outra marca → Leite');
select tests.eq((select household_product_id from private.match_purchase_item(:'hh', null, null, 'AGUA MINERAL CRYSTAL 500ML C/GAS CX12')), :'agua'::uuid, 'fardo de água → Água mineral com gás');
select tests.eq((select household_product_id from private.match_purchase_item(:'hh', null, null, 'AGUA SANIT SUPREMA 5L')), :'sanit'::uuid, 'AGUA SANIT → Água sanitária (não a mineral)');
select tests.eq((select household_product_id from private.match_purchase_item(:'hh', null, null, 'PAO FORMA SEVEN BOYS 450G LEITE')), :'pao'::uuid, '"...LEITE" no fim não vira Leite');
select tests.eq((select household_product_id from private.match_purchase_item(:'hh', null, null, 'SABAO BARRA YPE 160G C/5 COCO')), null::uuid, 'sabão em barra NÃO vira Sabonete');
select tests.eq((select household_product_id from private.match_purchase_item(:'hh', null, null, 'SABON TAB PALMOLIVE 150G')), :'sabonete'::uuid, 'SABON → Sabonete');

set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');

-- Nota nova: pão de outra marca entra no mesmo produto (lista/estoque distintos por item)
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","purchased_at":"2026-11-04T10:00:00-03:00","items":[{"description":"PAO FORMA WICKBOLD 500G","quantity":"2","total":"15.98"}]}'::jsonb) as p1 \gset
select public.confirm_purchase(:'p1') \gset
select tests.eq((select current_qty from public.household_products where id = :'pao'), 2.000::numeric, 'estoque do Pão de forma subiu');
select tests.eq((select count(*) from public.household_products where household_id = :'hh' and archived_at is null)::int, 7, 'nenhum produto duplicado criado');

-- Duplicado antigo: sugestão e junção
reset role;
insert into public.products (household_id, name, unit) values (:'hh', 'Pao Forma Seven Boys Leite 1un', 'un') returning id as dupprod \gset
insert into public.household_products (household_id, product_id, ideal_qty, current_qty) values (:'hh', :'dupprod', 2, 2) returning id as dup \gset
set role authenticated;
select tests.eq((select into_id from public.suggest_product_merges(:'hh') where from_id = :'dup'), :'pao'::uuid, 'sugere juntar o duplicado no Pão de forma');
select tests.eq((select count(*) from public.suggest_product_merges(:'hh') where from_id = :'sanit' and confidence = 'alta')::int, 0, 'não sugere (com certeza) juntar Água sanitária com a mineral');
select tests.eq((select confidence from public.suggest_product_merges(:'hh') where from_id = :'dup'), 'alta', 'duplicado do pão: confiança alta');

select list_id as lst from public.generate_shopping_list(:'hh') \gset
select public.merge_household_products(:'dup', :'pao');
select tests.eq((select current_qty from public.household_products where id = :'pao'), 4.000::numeric, 'estoque somado (2 + 2)');
select tests.eq((select archived_at is not null from public.household_products where id = :'dup'), true, 'duplicado arquivado');
select tests.eq((select count(*) from public.shopping_list_items where list_id = :'lst' and household_product_id = :'dup')::int, 0, 'lista sem o duplicado');
select tests.eq((select count(*) from public.suggest_product_merges(:'hh') where confidence = 'alta')::int, 0, 'sem mais sugestões de confiança alta');

-- Nível médio: mesma 1ª palavra ("Cogumelo fatiado" × "Cogumelo Odara Int")
select public.create_tracked_product(:'hh', 'Cogumelo fatiado', 'Saborosas', null, null, 100, 'g', null, null, 1, 1) as cog1 \gset
select public.create_tracked_product(:'hh', 'Cogumelo Odara Int', null, null, null, 100, 'g', null, null, 1, 1) as cog2 \gset
reset role;
update public.household_products set created_at = now() + interval '1 minute' where id = :'cog2';
set role authenticated;
select tests.eq((select into_id from public.suggest_product_merges(:'hh') where from_id = :'cog2'), :'cog1'::uuid, 'mesma 1ª palavra: sugere juntar no mais antigo');
select tests.eq((select confidence from public.suggest_product_merges(:'hh') where from_id = :'cog2'), 'media', 'confiança média');
select public.dismiss_product_merge(:'cog2', :'cog1');
select tests.eq((select count(*) from public.suggest_product_merges(:'hh') where from_id = :'cog2')::int, 0, '"não são o mesmo" esconde a sugestão');
select tests.expect_error(format($$ select public.merge_household_products(%L, %L) $$, :'pao', :'pao'), 'diferente');

select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.merge_household_products(%L, %L) $$, :'ovos', :'pao'), 'não encontrado');
select tests.expect_error(format($$ select * from public.suggest_product_merges(%L) $$, :'hh'), 'não encontrada');

\echo 'Produtos genéricos: todos os testes passaram.'
