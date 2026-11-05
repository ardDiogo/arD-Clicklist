-- Testes: montar a lista por um critério só (substitui a lista).
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
-- Arroz: abaixo do ideal (entra pelo estoque). Leite: ideal 0, mas comprado todo mês (entra pela média).
select public.create_tracked_product(:'hh', 'Arroz', null, null, null, null, 'un', null, null, 2, 0) as arroz \gset
select public.create_tracked_product(:'hh', 'Leite', null, null, null, null, 'un', null, null, 0, 0) as leite \gset
select public.create_purchase_draft(:'hh', 'manual', format('{"purchased_at":"%s","items":[{"description":"LEITE","quantity":"6","total":"30"}]}', (date_trunc('month', now()) - interval '1 month' + interval '5 days')::date || 'T10:00:00-03:00')::jsonb) \gset
select public.create_purchase_draft(:'hh', 'manual', format('{"purchased_at":"%s","items":[{"description":"LEITE","quantity":"6","total":"30"}]}', (date_trunc('month', now()) - interval '2 month' + interval '5 days')::date || 'T10:00:00-03:00')::jsonb) \gset
select public.create_purchase_draft(:'hh', 'manual', format('{"purchased_at":"%s","items":[{"description":"LEITE","quantity":"6","total":"30"}]}', (date_trunc('month', now()) - interval '3 month' + interval '5 days')::date || 'T10:00:00-03:00')::jsonb) \gset

select list_id as lst, added as a1 from public.rebuild_shopping_list(:'hh', 'average') \gset
select tests.eq((select count(*) from public.shopping_list_items where list_id = :'lst' and household_product_id = :'leite')::int, 1, 'média: leite entra');
select tests.eq((select count(*) from public.shopping_list_items where list_id = :'lst' and household_product_id = :'arroz')::int, 0, 'média: arroz (sem compras) não entra');

-- Item manual some ao trocar de critério
select public.add_custom_item_to_list(:'lst', 'Carvão', 1) \gset
select removed_items as r2, added as a2 from public.rebuild_shopping_list(:'hh', 'stock') \gset
select tests.eq(:'r2'::int, 2, 'estoque: limpou a lista (leite + carvão)');
select tests.eq((select count(*) from public.shopping_list_items where list_id = :'lst')::int, 1, 'estoque: só o arroz');
select tests.eq((select household_product_id from public.shopping_list_items where list_id = :'lst'), :'arroz'::uuid, 'estoque: arroz');

-- Volta para a média: substitui de novo
select public.rebuild_shopping_list(:'hh', 'average') \gset
select tests.eq((select household_product_id from public.shopping_list_items where list_id = :'lst'), :'leite'::uuid, 'média de novo: só o leite');

select tests.expect_error(format($$ select * from public.rebuild_shopping_list(%L, 'xyz') $$, :'hh'), 'Modo inválido');

\echo 'Montar a lista (substituir): todos os testes passaram.'
