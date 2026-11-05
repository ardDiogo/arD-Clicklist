-- Testes: remover lista finalizada (com e sem estorno do estoque).
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select public.create_tracked_product(:'hh', 'Arroz', null, null, null, null, 'un', null, null, 3, 0) as arroz \gset
select public.create_tracked_product(:'hh', 'Café', null, null, null, null, 'un', null, null, 2, 0) as cafe \gset

-- Lista 1: finalizada lançando no estoque (arroz 3, café 2)
select list_id as l1 from public.generate_shopping_list(:'hh') \gset
reset role;
update public.shopping_list_items set checked_at = now() where list_id = :'l1';
set role authenticated;
select public.complete_shopping_list(:'l1', true) \gset
select tests.eq((select current_qty from public.household_products where id = :'arroz'), 3.000::numeric, 'lista lançou arroz');

-- A lista aberta não pode ser removida
select public.get_or_create_open_list(:'hh') as open_l \gset
select tests.expect_error(format($$ select public.remove_shopping_list(%L) $$, :'open_l'), 'não pode ser removida');

-- Consumiu 2 cafés antes de remover (estorno não fica negativo)
select public.record_stock_movement(:'cafe', 'consumption', 2) \gset
select public.remove_shopping_list(:'l1', true) as reverted \gset
select tests.eq(:'reverted'::int, 1, 'estornou só o arroz (café já consumido)');
select tests.eq((select current_qty from public.household_products where id = :'arroz'), 0.000::numeric, 'arroz volta a 0');
select tests.eq((select current_qty from public.household_products where id = :'cafe'), 0.000::numeric, 'café não fica negativo');
select tests.eq((select count(*) from public.shopping_lists where id = :'l1')::int, 0, 'lista apagada do histórico');
select tests.eq((select count(*) from public.stock_movements where source_id = :'l1')::int, 3, 'movimentações ficam no histórico (2 lançamentos + 1 estorno)');

-- Lista 2: finalizada SEM lançar; removida sem mexer no estoque
select public.record_stock_movement(:'arroz', 'inventory_adjustment', 1) \gset
reset role;
delete from public.shopping_list_items where list_id = :'open_l';
insert into public.shopping_list_items (list_id, household_id, custom_name, quantity, origin, checked_at) values (:'open_l', :'hh', 'Sal', 1, 'manual', now());
set role authenticated;
select public.complete_shopping_list(:'open_l', false) \gset
select public.remove_shopping_list(:'open_l', true) as rev2 \gset
select tests.eq(:'rev2'::int, 0, 'lista sem lançamento: nada a estornar');
select tests.eq((select current_qty from public.household_products where id = :'arroz'), 1.000::numeric, 'estoque intacto');

-- Permissão
select list_id as l3 from public.generate_shopping_list(:'hh') \gset
select public.complete_shopping_list(:'l3', false) \gset
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.remove_shopping_list(%L) $$, :'l3'), 'não encontrada');

\echo 'Remover lista: todos os testes passaram.'
