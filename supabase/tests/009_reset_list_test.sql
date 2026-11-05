-- Testes: recomeçar a lista de compras.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'leitor@example.com');

set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select public.create_household_invite(:'hh', 'viewer') as tok \gset

-- Arroz: quanto manter 2, em casa 0 (entra pelo estoque)
select public.create_tracked_product(:'hh', 'Arroz', null, null, null, null, 'un', null, null, 2, 0) as arroz \gset
-- Café: sem meta, mas comprado todo mês (entra pelo consumo)
select public.create_tracked_product(:'hh', 'Café', null, null, null, null, 'un', null, null, 0, 0) as cafe \gset
select public.create_purchase_draft(:'hh', 'manual', format('{"purchased_at":"%s-15T12:00:00-03:00","items":[{"description":"CAFE","quantity":"1","total":"20"}]}',
  to_char((date_trunc('month', now()) - interval '1 month'), 'YYYY-MM'))::jsonb) as p1 \gset
select public.update_purchase_item((select id from public.purchase_items where purchase_id = :'p1'), :'cafe', false, false, 1);
select public.confirm_purchase(:'p1') \gset

-- Lista bagunçada: item manual, quantidade alterada, item no carrinho e item removido
select list_id as list from public.generate_shopping_list(:'hh') \gset
select public.add_custom_item_to_list(:'list', 'Vela', 1) \gset
select public.update_list_item((select id from public.shopping_list_items where household_product_id = :'arroz'), 9);
select public.set_list_item_checked((select id from public.shopping_list_items where custom_name = 'Vela'), true);

select removed_items, added_from_stock, added_from_history from public.reset_shopping_list(:'hh') \gset
select tests.eq(:'removed_items'::int, 2, 'apagou os 2 itens da lista anterior');
select tests.eq((select count(*) from public.shopping_list_items where list_id = :'list' and custom_name = 'Vela')::int, 0,
                'item manual/no carrinho saiu');
select tests.eq((select quantity from public.shopping_list_items where household_product_id = :'arroz'), 2.000::numeric,
                'arroz volta com a quantidade calculada (ideal 2 − 0), não a ajustada (9)');
select tests.eq(:'added_from_stock'::int, 1, 'um item pelo estoque');
select tests.eq(:'added_from_history'::int, 0, 'café: 1 em 3 meses é ocasional — não sugerido com 3 meses');

-- Com 1 mês de referência o café passa a ser mensal
select added_from_history as h1 from public.reset_shopping_list(:'hh', 1) \gset
select tests.eq(:'h1'::int, 1, 'com período de 1 mês, café é sugerido');
select tests.eq((select origin::text from public.shopping_list_items where household_product_id = :'cafe'), 'suggestion',
                'café entra com origem sugestão');
select tests.eq((select count(*) from public.shopping_lists where household_id = :'hh')::int, 1, 'continua uma única lista aberta');

-- Leitor não pode
select tests.login('00000000-0000-0000-0000-00000000000b');
select public.accept_household_invite(:'tok') \gset
select tests.expect_error(format($$ select * from public.reset_shopping_list(%L) $$, :'hh'), 'permissão');

\echo 'Recomeçar lista: todos os testes passaram.'
