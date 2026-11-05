-- Testes: estatísticas por comprador.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com', '{"full_name":"Diogo"}'),
  ('00000000-0000-0000-0000-00000000000b', 'esposa@example.com', '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com', '{}');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
reset role;
insert into public.household_members (household_id, user_id, role) values (:'hh', '00000000-0000-0000-0000-00000000000b', 'editor');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');

-- Diogo: 2 compras (100 + 50) no Mart Minas; Ana: 1 compra (90) no Super BH; 1 sem comprador (10)
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","purchased_at":"2026-10-05T10:00:00-03:00","total":"100","items":[{"description":"ARROZ","quantity":"1","total":"100"}]}'::jsonb) as p1 \gset
select public.confirm_purchase(:'p1') \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","purchased_at":"2026-10-12T10:00:00-03:00","total":"50","items":[{"description":"CAFE","quantity":"1","total":"50"}]}'::jsonb) as p2 \gset
select public.confirm_purchase(:'p2') \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Super BH","purchased_at":"2026-10-20T10:00:00-03:00","total":"90","items":[{"description":"LEITE","quantity":"6","total":"30"},{"description":"PAO","quantity":"1","total":"60"}]}'::jsonb) as p3 \gset
select public.confirm_purchase(:'p3') \gset
select public.set_purchase_buyer(:'p3', '00000000-0000-0000-0000-00000000000b');
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Super BH","purchased_at":"2026-10-22T10:00:00-03:00","total":"10","items":[{"description":"SAL","quantity":"1","total":"10"}]}'::jsonb) as p4 \gset
select public.confirm_purchase(:'p4') \gset
select public.set_purchase_buyer(:'p4', null);
-- Mês anterior: Diogo gastou 100
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","purchased_at":"2026-09-10T10:00:00-03:00","total":"100","items":[{"description":"ARROZ","quantity":"1","total":"100"}]}'::jsonb) as p0 \gset
select public.confirm_purchase(:'p0') \gset

select public.intel_buyers(:'hh', '2026-10-01', '2026-10-31') as b \gset
select tests.eq(jsonb_array_length(:'b'::jsonb), 3, '3 grupos: Diogo, Ana e não informado');
select tests.eq(:'b'::jsonb #>> '{0,name}', 'Diogo', 'quem mais gastou primeiro, com nome do perfil');
select tests.eq((:'b'::jsonb #>> '{0,purchases}')::int, 2, 'Diogo: 2 compras');
select tests.eq((:'b'::jsonb #>> '{0,total}')::numeric, 150::numeric, 'Diogo: 150');
select tests.eq((:'b'::jsonb #>> '{0,avg_ticket}')::numeric, 75.00::numeric, 'Diogo: ticket médio 75');
select tests.eq((:'b'::jsonb #>> '{0,share}')::numeric, 0.6::numeric, 'Diogo: 150 / 250');
select tests.eq((:'b'::jsonb #>> '{0,change_pct}')::numeric, 50.0::numeric, 'Diogo: +50% vs. setembro');
select tests.eq(:'b'::jsonb #>> '{0,top_store}', 'Mart Minas', 'Diogo: mercado mais usado');
select tests.eq(:'b'::jsonb #>> '{1,name}', 'Ana', 'Ana em segundo');
select tests.eq(:'b'::jsonb #>> '{1,change_pct}', null, 'Ana sem base anterior');
select tests.eq((:'b'::jsonb #>> '{1,products}')::int, 2, 'Ana: 2 produtos');
select tests.eq(:'b'::jsonb #>> '{2,name}', 'Não informado', 'compra sem comprador');

-- Com filtro de produto/categoria vale a soma das linhas (Ana: só LEITE = 30)
select public.intel_buyers(:'hh', '2026-10-20', '2026-10-20', '22222222000122') as bs \gset
select tests.eq(jsonb_array_length(:'bs'::jsonb), 0, 'filtro de mercado inexistente: vazio');

select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.intel_buyers(%L, '2026-10-01', '2026-10-31') $$, :'hh'), 'não encontrada');

\echo 'Estatísticas por comprador: todos os testes passaram.'
