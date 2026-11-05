-- Testes da Fase 6: indicadores financeiros com dados reais e isolados por família.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com', '{"full_name":"Diogo"}'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com', '{"full_name":"Outra"}');

set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh_a \gset
select id as merc from public.categories where name = 'Mercearia' and household_id is null \gset
select id as limp from public.categories where name = 'Limpeza' and household_id is null \gset
select public.create_tracked_product(:'hh_a', 'Café', 'Melitta', :'merc', null, 500, 'g', '7891021006125', null, 2, 0) as cafe \gset
select public.create_tracked_product(:'hh_a', 'Detergente', 'Ypê', :'limp', null, 500, 'ml', '7896098900208', null, 3, 0) as deterg \gset

-- Outubro: Mercado X (café 2 × 18,00 + detergente 3 × 2,50) = 43,50
select public.create_purchase_draft(:'hh_a', 'manual', '{"store_name":"Mercado X","store_cnpj":"11111111000111","purchased_at":"2026-10-10T10:00:00-03:00","total":"43.50","items":[{"description":"CAFE","ean":"7891021006125","quantity":"2","unit_price":"18","total":"36"},{"description":"DETERG","ean":"7896098900208","quantity":"3","unit_price":"2.5","total":"7.5"}]}'::jsonb) as p1 \gset
select public.confirm_purchase(:'p1') \gset
-- Novembro: Mercado X (café 1 × 21,60) e Mercado Y sem total no cupom (detergente 2 × 3,00 + item sem produto 10,00)
select public.create_purchase_draft(:'hh_a', 'manual', '{"store_name":"Mercado X","store_cnpj":"11111111000111","purchased_at":"2026-11-03T10:00:00-03:00","total":"21.60","items":[{"description":"CAFE","ean":"7891021006125","quantity":"1","unit_price":"21.6","total":"21.6"}]}'::jsonb) as p2 \gset
select public.confirm_purchase(:'p2') \gset
select public.create_purchase_draft(:'hh_a', 'manual', '{"store_name":"Mercado Y","purchased_at":"2026-11-08T20:00:00-03:00","items":[{"description":"DETERG","ean":"7896098900208","quantity":"2","unit_price":"3","total":"6"},{"description":"PRESENTE","quantity":"1","total":"10"}]}'::jsonb) as p3 \gset
select public.confirm_purchase(:'p3') \gset
-- Rascunho não conta
select public.create_purchase_draft(:'hh_a', 'manual', '{"store_name":"Rascunho","purchased_at":"2026-11-09T10:00:00-03:00","total":"999","items":[{"description":"X","quantity":"1","total":"999"}]}'::jsonb) as p4 \gset

-- Compra feita 31/10 23:30 no horário de Brasília (já 1/11 em UTC) conta em outubro
select public.create_purchase_draft(:'hh_a', 'manual', '{"store_name":"Mercado X","store_cnpj":"11111111000111","purchased_at":"2026-10-31T23:30:00-03:00","total":"5","items":[{"description":"BALA","quantity":"1","total":"5"}]}'::jsonb) as p5 \gset
select public.confirm_purchase(:'p5') \gset

select tests.eq((select count(*) from public.purchase_totals)::int, 4, 'somente compras confirmadas');
select tests.eq((select total from public.purchase_totals where id = :'p3'), 16.00::numeric, 'sem total no cupom, usa a soma dos itens');
select tests.eq((select total from public.monthly_spending where month = '2026-10-01'), 48.50::numeric, 'outubro = 43,50 + 5,00 (fuso de Brasília)');
select tests.eq((select total from public.monthly_spending where month = '2026-11-01'), 37.60::numeric, 'novembro = 21,60 + 16,00');
select tests.eq((select avg_ticket from public.monthly_spending where month = '2026-11-01'), 18.80::numeric, 'ticket médio de novembro');
select tests.eq((select purchases from public.monthly_spending where month = '2026-10-01'), 2, 'duas compras em outubro');

select tests.eq((select total from public.category_spending where month = '2026-11-01' and category_name = 'Mercearia'), 21.60::numeric,
                'mercearia em novembro');
select tests.eq((select total from public.category_spending where month = '2026-11-01' and category_name = 'Limpeza'), 6.00::numeric,
                'limpeza em novembro');
select tests.eq((select total from public.category_spending where month = '2026-11-01' and category_name = 'Não associados'), 10.00::numeric,
                'item sem produto aparece como não associado');

select tests.eq((select visits from public.store_spending where store_name = 'Mercado X'), 3, 'três visitas ao Mercado X');
select tests.eq((select total from public.store_spending where store_name = 'Mercado X'), 70.10::numeric, 'total gasto no Mercado X');

select tests.eq((select variation_pct from public.price_changes where household_product_id = :'cafe'), 20.0::numeric,
                'café subiu 20% (18,00 → 21,60)');
select tests.eq((select variation_pct from public.price_changes where household_product_id = :'deterg'), 20.0::numeric,
                'detergente subiu 20% (2,50 → 3,00)');
select tests.eq((select product_name from public.price_changes where household_product_id = :'cafe'), 'Café', 'nome do produto incluso');

-- Isolamento
select tests.login('00000000-0000-0000-0000-00000000000c');
select public.create_household('Casa C') \gset
select tests.eq((select count(*) from public.purchase_totals)::int, 0, 'C não vê compras de A');
select tests.eq((select count(*) from public.monthly_spending)::int, 0, 'C não vê gastos de A');
select tests.eq((select count(*) from public.category_spending)::int, 0, 'C não vê categorias de A');
select tests.eq((select count(*) from public.store_spending)::int, 0, 'C não vê estabelecimentos de A');
select tests.eq((select count(*) from public.price_changes)::int, 0, 'C não vê preços de A');

reset role;
set role anon;
select tests.expect_error($$ select * from public.monthly_spending $$, 'permission denied');

\echo 'Fase 6: todos os testes passaram.'
