-- Testes: sugestão de compras pelo histórico de consumo.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com',  '{"full_name":"Diogo"}'),
  ('00000000-0000-0000-0000-00000000000b', 'leitor@example.com', '{"full_name":"Leitor"}');

set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select public.create_household_invite(:'hh', 'viewer') as tok \gset

select public.create_tracked_product(:'hh', 'Ketchup', 'Bonare', null, 'Zero') as ketchup \gset
select public.create_tracked_product(:'hh', 'Sabonete', 'Farnese', null, 'Pitaya') as sab_pitaya \gset
select public.create_tracked_product(:'hh', 'Sabonete', 'Farnese', null, 'Erva-doce') as sab_erva \gset
select public.create_tracked_product(:'hh', 'Amaciante', 'Downy') as amaciante \gset
select public.create_tracked_product(:'hh', 'Arroz', 'Vasconcelos') as arroz \gset
select public.create_tracked_product(:'hh', 'Café', '3 Corações') as cafe \gset

-- Histórico: ago (ketchup 3, sabonete pitaya 2, amaciante 1), set (ketchup 1, sabonete erva 3, arroz 1),
-- out (ketchup 2, arroz 1, café 1). Itens desmarcados: não mexem no estoque.
select public.create_purchase_draft(:'hh', 'manual', format('{"purchased_at":"2026-08-10T12:00:00-03:00","items":[
  {"description":"KETCHUP","quantity":"3","total":"27"},{"description":"SAB PITAYA","quantity":"2","total":"8"},
  {"description":"DOWNY","quantity":"1","total":"65"}]}')::jsonb) as p_ago \gset
select public.create_purchase_draft(:'hh', 'manual', '{"purchased_at":"2026-09-08T12:00:00-03:00","items":[
  {"description":"KETCHUP","quantity":"1","total":"9"},{"description":"SAB ERVA","quantity":"3","total":"12"},
  {"description":"ARROZ","quantity":"1","total":"25"}]}'::jsonb) as p_set \gset
select public.create_purchase_draft(:'hh', 'manual', '{"purchased_at":"2026-10-10T12:00:00-03:00","items":[
  {"description":"KETCHUP","quantity":"2","total":"18"},{"description":"ARROZ","quantity":"1","total":"25"},
  {"description":"CAFE","quantity":"1","total":"22"}]}'::jsonb) as p_out \gset
-- Compra do próprio mês de referência (novembro) não entra na média
select public.create_purchase_draft(:'hh', 'manual', '{"purchased_at":"2026-11-03T12:00:00-03:00","items":[
  {"description":"KETCHUP NOV","quantity":"9","total":"81"}]}'::jsonb) as p_nov \gset

-- Associa os itens aos produtos (todos desmarcados)
select public.update_purchase_item(id, case
  when description like 'KETCHUP%' then :'ketchup'::uuid
  when description = 'SAB PITAYA' then :'sab_pitaya'::uuid
  when description = 'SAB ERVA' then :'sab_erva'::uuid
  when description = 'DOWNY' then :'amaciante'::uuid
  when description = 'ARROZ' then :'arroz'::uuid
  when description = 'CAFE' then :'cafe'::uuid end, false, false, stock_quantity)
from public.purchase_items;

-- Estoque atual: 1 ketchup em casa
select public.record_stock_movement(:'ketchup', 'inventory_adjustment', 1) \gset

select list_id, added, months_with_data from public.suggest_shopping_from_history(:'hh', 3, '2026-11-15') \gset
select tests.eq(:'months_with_data'::int, 3, 'três meses de histórico (ago, set, out)');
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'ketchup'), 1.000::numeric,
                'ketchup: média 2/mês (3+1+2)/3, menos 1 em casa = 1 (compra de novembro ignorada)');
select tests.eq((select origin::text from public.shopping_list_items where household_product_id = :'ketchup'), 'suggestion',
                'origem registrada como sugestão');
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'sab_erva'), 2.000::numeric,
                'sabonetes somados (2+3)/3 ≈ 2, na variação mais recente');
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'sab_pitaya')::int, 0,
                'variação antiga não entra duplicada');
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'arroz'), 1.000::numeric,
                'arroz: (0+1+1)/3 ≈ 1');
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'amaciante')::int, 0,
                'compra ocasional (1 em 3 meses) não é sugerida');
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'cafe')::int, 0,
                'café: 1 em 3 meses (0,33) não é sugerido');
select tests.eq(:'added'::int, 3, 'três sugestões adicionadas');

-- Não duplica e respeita itens presentes/removidos
select added as again from public.suggest_shopping_from_history(:'hh', 3, '2026-11-15') \gset
select tests.eq(:'again'::int, 0, 'sugerir de novo não duplica');
select public.update_list_item((select id from public.shopping_list_items where household_product_id = :'ketchup'), 5);
select public.remove_list_item((select id from public.shopping_list_items where household_product_id = :'arroz'));
select public.suggest_shopping_from_history(:'hh', 3, '2026-11-15') \gset
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'ketchup'), 5.000::numeric,
                'quantidade ajustada pelo usuário é mantida');
select tests.eq((select count(*) from public.shopping_list_items_view where household_product_id = :'arroz')::int, 0,
                'item removido pelo usuário não volta');

-- Estoque suficiente: nada sugerido
select tests.eq((select added from public.suggest_shopping_from_history(:'hh', 1, '2026-10-01')), 0,
                'em outubro (base: setembro) o que falta já está na lista ou removido');

-- Validações e permissões
select tests.expect_error(format($$ select * from public.suggest_shopping_from_history(%L, 0) $$, :'hh'), 'Período inválido');
select tests.login('00000000-0000-0000-0000-00000000000b');
select public.accept_household_invite(:'tok') \gset
select tests.expect_error(format($$ select * from public.suggest_shopping_from_history(%L) $$, :'hh'), 'permissão');

\echo 'Sugestão pelo histórico: todos os testes passaram.'
