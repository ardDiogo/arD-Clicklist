-- Testes: produto "Não envia à lista".
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select public.create_tracked_product(:'hh', 'Marmitex', null, null, null, null, 'un', '7890000000097', null, 5, 0) as marmita \gset
select public.create_tracked_product(:'hh', 'Arroz', null, null, null, null, 'un', '7890000000011', null, 2, 0) as arroz \gset

-- Já estava na lista antes de marcar
select list_id as lst from public.generate_shopping_list(:'hh') \gset
select tests.eq((select count(*) from public.shopping_list_items where list_id = :'lst' and household_product_id = :'marmita')::int, 1, 'antes: marmitex entra pelo estoque');

select public.set_product_list_exclusion(:'marmita', true) as removed \gset
select tests.eq(:'removed'::int, 1, 'ao marcar, sai da lista aberta');
select tests.eq((select status from public.household_stock where id = :'marmita'), 'untracked', 'não conta como em falta');
select tests.eq((select to_buy_qty from public.household_stock where id = :'marmita'), 0::numeric, 'nada a comprar');
select tests.eq((select exclude_from_list from public.household_stock where id = :'marmita'), true, 'view expõe a marcação');

-- Gerar de novo não traz de volta
select added as a from public.generate_shopping_list(:'hh') \gset
select tests.eq((select count(*) from public.shopping_list_items where list_id = :'lst' and household_product_id = :'marmita')::int, 0, 'gerar pelo estoque ignora o produto');

-- Histórico de compras também não traz
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","purchased_at":"2026-08-10T10:00:00-03:00","items":[{"description":"MARMITEX","ean":"7890000000097","quantity":"20","total":"400"}]}'::jsonb) as p1 \gset
select public.confirm_purchase(:'p1') \gset
select public.record_stock_movement(:'marmita', 'consumption', 20) \gset
select public.reset_shopping_list(:'hh', 3) \gset
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'marmita' and removed_at is null)::int, 0, 'recomeçar lista (estoque + histórico) ignora o produto');
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'arroz' and removed_at is null)::int, 1, 'outros produtos continuam entrando');

-- À mão ainda pode
select public.add_product_to_list(public.get_or_create_open_list(:'hh'), :'marmita', 2) \gset
select tests.eq((select count(*) from public.shopping_list_items where household_product_id = :'marmita' and removed_at is null)::int, 1, 'adicionar à mão continua possível');

-- Desmarcar volta ao normal
select public.set_product_list_exclusion(:'marmita', false) \gset
select tests.eq((select status from public.household_stock where id = :'marmita'), 'out', 'desmarcado volta a pedir reposição');

-- Permissão
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.set_product_list_exclusion(%L, true) $$, :'marmita'), 'não encontrado');

\echo 'Não envia à lista: todos os testes passaram.'
