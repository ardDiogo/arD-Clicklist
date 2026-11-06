-- Testes: compras sem CNPJ herdam o CNPJ do mesmo mercado (pelo nome).
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset

-- Três compras antigas sem CNPJ (nome escrito de jeitos diferentes)
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"ARAGUARI - 221","purchased_at":"2026-08-10T10:00:00-03:00","total":"10","items":[{"description":"ARROZ","quantity":"1","total":"10"}]}'::jsonb) as p1 \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"ARAGUARI - 221","purchased_at":"2026-09-08T10:00:00-03:00","total":"20","items":[{"description":"ARROZ","quantity":"1","total":"20"}]}'::jsonb) as p2 \gset
select public.confirm_purchase(:'p1') \gset
select public.confirm_purchase(:'p2') \gset
-- Renomeadas pelo lápis para o nome do mercado
select public.rename_purchase_store(:'p1', 'Mart Minas Distribuicao Ltda', true) \gset
-- Chega a compra com CNPJ
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"MART MINAS DISTRIBUICAO LTDA","store_cnpj":"04737552002181","purchased_at":"2026-11-04T10:00:00-03:00","total":"30","items":[{"description":"ARROZ","quantity":"1","total":"30"}]}'::jsonb) as p3 \gset
select public.confirm_purchase(:'p3') \gset
select tests.eq((select count(*) from public.purchases where store_cnpj = '04737552002181')::int, 3, 'as antigas receberam o CNPJ ao chegar a compra com CNPJ');

-- Nova compra manual sem CNPJ, mesmo nome: herda
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas Distribuição LTDA.","purchased_at":"2026-11-05T10:00:00-03:00","total":"5","items":[{"description":"SAL","quantity":"1","total":"5"}]}'::jsonb) as p4 \gset
select tests.eq((select store_cnpj from public.purchases where id = :'p4'), '04737552002181', 'compra nova sem CNPJ herda (acentos/pontuação ignorados)');

-- Outro mercado continua separado
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Super BH","purchased_at":"2026-11-05T11:00:00-03:00","total":"7","items":[{"description":"SAL","quantity":"1","total":"7"}]}'::jsonb) as p5 \gset
select tests.eq((select store_cnpj from public.purchases where id = :'p5'), null::text, 'outro mercado não recebe CNPJ');

-- Inteligência: um mercado só para as compras do Mart Minas confirmadas
select tests.eq((select jsonb_array_length(public.intel_stores(:'hh', '2026-08-01', '2026-11-30') -> 'ranking')), 1, 'ranking: 1 mercado');
select tests.eq((select (public.intel_stores(:'hh', '2026-08-01', '2026-11-30') #>> '{ranking,0,visits}')::int), 3, 'Mart Minas: 3 visitas confirmadas');

\echo 'CNPJ pelo nome: todos os testes passaram.'
