-- Testes da Fase 3: lista de compras inteligente.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com',  '{"full_name":"Diogo"}'),
  ('00000000-0000-0000-0000-00000000000b', 'leitor@example.com', '{"full_name":"Leitor"}'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com',  '{"full_name":"Outra"}');

set role authenticated;

select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh_a \gset
select public.create_household_invite(:'hh_a', 'viewer') as tok \gset
select tests.login('00000000-0000-0000-0000-00000000000b');
select public.accept_household_invite(:'tok') \gset
select tests.login('00000000-0000-0000-0000-00000000000c');
select public.create_household('Casa C') as hh_c \gset
select public.create_tracked_product(:'hh_c', 'Produto de C', null, null, null, null, 'un', null, null, 5, 0) as prod_c \gset

-- Exemplo do enunciado: Ketchup 3/1, Sabonete 5/2, Sardinha 6/4, Arroz 1/1, Café 1/0
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_tracked_product(:'hh_a', 'Ketchup',  null, null, null, null, 'un', null, null, 3, 1) as ketchup \gset
select public.create_tracked_product(:'hh_a', 'Sabonete', null, null, null, null, 'un', null, null, 5, 2) as sabonete \gset
select public.create_tracked_product(:'hh_a', 'Sardinha', null, null, null, null, 'un', null, null, 6, 4) as sardinha \gset
select public.create_tracked_product(:'hh_a', 'Arroz',    null, null, null, null, 'un', null, null, 1, 1) as arroz \gset
select public.create_tracked_product(:'hh_a', 'Café',     null, null, null, null, 'un', null, null, 1, 0) as cafe \gset

-- ---------------------------------------------------------------------------
-- Geração automática
-- ---------------------------------------------------------------------------
select list_id as list, added from public.generate_shopping_list(:'hh_a') \gset
select tests.eq(:'added'::int, 4, 'geração inclui os 4 produtos com falta (arroz fica fora)');
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'ketchup'), 2.000::numeric, 'ketchup: comprar 2');
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'sabonete'), 3.000::numeric, 'sabonete: comprar 3');
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'sardinha'), 2.000::numeric, 'sardinha: comprar 2');
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'cafe'), 1.000::numeric, 'café: comprar 1');
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'arroz')::int, 0, 'arroz não entra');
select tests.eq((select origin::text from public.shopping_list_items where household_product_id = :'cafe'), 'stock', 'origem stock');

-- Gerar de novo não duplica e reaproveita a mesma lista
select list_id as list2, added as added2 from public.generate_shopping_list(:'hh_a') \gset
select tests.eq(:'list2'::text, :'list'::text, 'uma única lista aberta por família');
select tests.eq(:'added2'::int, 0, 'segunda geração não adiciona nada');
select tests.eq((select count(*) from public.shopping_list_items where list_id = :'list')::int, 4, 'sem itens duplicados');

-- ---------------------------------------------------------------------------
-- Alterações manuais são preservadas
-- ---------------------------------------------------------------------------
-- Usuário muda a quantidade do sabonete para 10
select public.update_list_item((select id from public.shopping_list_items where household_product_id = :'sabonete'), 10, 2.49);
-- Estoque muda: consumo de ketchup e sardinha
select public.record_stock_movement(:'ketchup', 'consumption', 1) \gset
select public.record_stock_movement(:'sabonete', 'consumption', 1) \gset
select updated as upd from public.generate_shopping_list(:'hh_a') \gset
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'ketchup'), 3.000::numeric,
                'item automático acompanha o estoque (ketchup agora 3)');
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'sabonete'), 10.000::numeric,
                'quantidade editada manualmente não é sobrescrita');
select tests.eq((select estimated_total from public.shopping_list_items_view where household_product_id = :'sabonete'), 24.90::numeric,
                'total estimado = preço × quantidade');

-- Adicionar manualmente um produto que já está na lista soma, não duplica
select public.add_product_to_list(:'list', :'cafe', 2) \gset
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'cafe'), 3.000::numeric,
                'inclusão manual de item existente soma a quantidade');
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'cafe')::int, 1,
                'inclusão manual não duplica');

-- Produto sem falta pode ser incluído manualmente
select public.add_product_to_list(:'list', :'arroz', 1) \gset
select tests.eq((select origin::text from public.shopping_list_items where household_product_id = :'arroz'), 'manual', 'origem manual');
select public.generate_shopping_list(:'hh_a') \gset
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'arroz')::int, 1,
                'geração não remove item manual mesmo sem falta no estoque');

-- Item livre (fora do estoque), sem duplicar por maiúsculas
select public.add_custom_item_to_list(:'list', 'Vela de aniversário', 1) \gset
select public.add_custom_item_to_list(:'list', 'VELA DE ANIVERSÁRIO ', 1) \gset
select tests.eq((select quantity from public.shopping_list_items where custom_name is not null), 2.000::numeric,
                'item livre repetido soma, sem duplicar');
select tests.eq((select category_name from public.shopping_list_items_view where household_product_id is null), 'Outros',
                'item livre cai em Outros');

-- Item automático que deixa de faltar sai da lista (se não foi tocado)
select public.record_stock_movement(:'sardinha', 'purchase', 2) \gset
select removed as rem from public.generate_shopping_list(:'hh_a') \gset
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'sardinha')::int, 0,
                'sardinha reposta sai da lista na geração');

-- Remoção pelo usuário é respeitada na próxima geração
select public.remove_list_item((select id from public.shopping_list_items where household_product_id = :'ketchup'));
select public.generate_shopping_list(:'hh_a') \gset
select tests.eq((select count(*) from public.shopping_list_items_view where household_product_id = :'ketchup')::int, 0,
                'item removido pelo usuário não volta sozinho');
select public.add_product_to_list(:'list', :'ketchup', 1) \gset
select tests.eq((select quantity from public.shopping_list_items_view where household_product_id = :'ketchup'), 1.000::numeric,
                'mas pode ser adicionado de volta manualmente');

-- Validações
select tests.expect_error(format($$ select public.add_product_to_list(%L, %L, 1) $$, :'list', :'prod_c'), 'outra família');
select tests.expect_error(format($$ select public.add_product_to_list(%L, %L, 0) $$, :'list', :'cafe'), 'maior que zero');
select tests.expect_error(
  format($$ select public.update_list_item(%L, -1) $$, (select id from public.shopping_list_items where household_product_id = :'cafe')),
  'maior que zero');

-- ---------------------------------------------------------------------------
-- Permissões e isolamento
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.eq((select count(*) from public.shopping_list_items_view where list_id = :'list')::int, 5, 'leitor vê a lista');
select tests.expect_error(format($$ select public.add_product_to_list(%L, %L, 1) $$, :'list', :'cafe'), 'não encontrada');
select tests.expect_error(format($$ select public.generate_shopping_list(%L) $$, :'hh_a'), 'permissão');
select tests.expect_error($$ update public.shopping_list_items set quantity = 99 $$, 'permission denied');

select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.eq((select count(*) from public.shopping_lists where household_id = :'hh_a')::int, 0, 'C não vê listas de A');
select tests.eq((select count(*) from public.shopping_list_items_view)::int, 0, 'C não vê itens de A');
select tests.expect_error(
  format($$ select public.set_list_item_checked(%L, true) $$, (select id from public.shopping_list_items limit 1)),
  'não encontrado');

-- ---------------------------------------------------------------------------
-- Marcar e finalizar (com entrada no estoque, idempotente)
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.set_list_item_checked((select id from public.shopping_list_items where household_product_id = :'cafe'), true);
select public.set_list_item_checked((select id from public.shopping_list_items where household_product_id = :'sabonete'), true);
select public.set_list_item_checked((select id from public.shopping_list_items where custom_name is not null), true);

select current_qty as cafe_before from public.household_products where id = :'cafe' \gset
select applied_items from public.complete_shopping_list(:'list', true) \gset
select tests.eq(:'applied_items'::int, 2, 'só itens marcados do estoque entram (item livre não)');
select tests.eq((select current_qty from public.household_products where id = :'cafe'), :'cafe_before'::numeric + 3,
                'café comprado entrou no estoque');
select tests.eq((select count(*) from public.stock_movements where source = 'purchase' and source_id = :'list')::int, 2,
                'movimentações de compra vinculadas à lista');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 0.000::numeric,
                'item não marcado não altera o estoque');

-- Finalizar de novo não duplica
select applied_items as again from public.complete_shopping_list(:'list', true) \gset
select tests.eq(:'again'::int, 0, 'finalizar de novo é idempotente');
select tests.eq((select count(*) from public.stock_movements where source_id = :'list')::int, 2, 'sem entradas duplicadas');

-- Lista finalizada não pode ser editada
select tests.expect_error(format($$ select public.add_product_to_list(%L, %L, 1) $$, :'list', :'cafe'), 'já foi finalizada');

-- Próxima geração abre uma nova lista
select list_id as list3 from public.generate_shopping_list(:'hh_a') \gset
select tests.eq(:'list3'::text <> :'list'::text, true, 'nova lista aberta após finalizar');
select tests.eq((select count(*) from public.shopping_lists where household_id = :'hh_a')::int, 2, 'histórico mantém a lista anterior');

-- Finalizar sem lançar no estoque
select public.set_list_item_checked((select id from public.shopping_list_items where list_id = :'list3' limit 1), true);
select applied_items as none from public.complete_shopping_list(:'list3', false) \gset
select tests.eq(:'none'::int, 0, 'finalizar sem lançar não mexe no estoque');

\echo 'Fase 3: todos os testes passaram.'
