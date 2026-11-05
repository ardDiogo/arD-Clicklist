-- Testes: renomear o estabelecimento das compras.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"ARAGUARI - 221","purchased_at":"2026-08-10T12:00:00-03:00","items":[{"description":"A","quantity":"1","total":"10"}]}'::jsonb) as p1 \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"araguari - 221 ","purchased_at":"2026-09-08T12:00:00-03:00","items":[{"description":"B","quantity":"1","total":"20"}]}'::jsonb) as p2 \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Outro Mercado","purchased_at":"2026-10-10T12:00:00-03:00","items":[{"description":"C","quantity":"1","total":"30"}]}'::jsonb) as p3 \gset
select public.confirm_purchase(:'p1') \gset

select public.rename_purchase_store(:'p1', 'Mart Minas Araguari') as n \gset
select tests.eq(:'n'::int, 2, 'renomeia a compra e as outras com o mesmo nome (ignora maiúsculas/espaços)');
select tests.eq((select store_name from public.purchases where id = :'p1'), 'Mart Minas Araguari', 'compra confirmada também pode ser renomeada');
select tests.eq((select store_name from public.purchases where id = :'p3'), 'Outro Mercado', 'outro mercado não muda');
select tests.eq((select store_name from public.store_spending where store_name = 'Mart Minas Araguari'), 'Mart Minas Araguari',
                'Financeiro passa a mostrar o novo nome');

select public.rename_purchase_store(:'p3', 'Atacadão', false) as n2 \gset
select tests.eq(:'n2'::int, 1, 'só a compra escolhida quando não aplica às demais');
select tests.expect_error(format($$ select public.rename_purchase_store(%L, '  ') $$, :'p3'), 'Informe o nome');

select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.rename_purchase_store(%L, 'Hack') $$, :'p1'), 'não encontrada');

\echo 'Renomear estabelecimento: todos os testes passaram.'
