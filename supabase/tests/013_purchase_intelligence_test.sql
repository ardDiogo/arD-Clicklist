-- Testes: inteligência de compras (cálculos conferidos à mão).
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select id as merc from public.categories where name = 'Mercearia' and household_id is null \gset
select id as beb from public.categories where name = 'Bebidas' and household_id is null \gset
select public.create_tracked_product(:'hh', 'Arroz 5kg', 'Tio João', :'merc', null, 5, 'kg', '7890000000011', null, 2, 0) as arroz \gset
select public.create_tracked_product(:'hh', 'Café 500g', 'Melitta', :'beb', null, 500, 'g', '7890000000028', null, 2, 0) as cafe \gset

-- Setembro (período anterior): Mart Minas, café 16,00
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","store_cnpj":"11111111000111","purchased_at":"2026-09-10T10:00:00-03:00","total":"16.00","items":[{"description":"CAFE","ean":"7890000000028","quantity":"1","total":"16.00"}]}'::jsonb) as p0 \gset
select public.confirm_purchase(:'p0') \gset
-- Outubro
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","store_cnpj":"11111111000111","purchased_at":"2026-10-05T10:00:00-03:00","total":"61.90","items":[{"description":"ARROZ","ean":"7890000000011","quantity":"1","total":"25.90"},{"description":"CAFE","ean":"7890000000028","quantity":"2","total":"36.00"}]}'::jsonb) as p1 \gset
select public.confirm_purchase(:'p1') \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Super BH","store_cnpj":"22222222000122","purchased_at":"2026-10-12T10:00:00-03:00","total":"42.90","items":[{"description":"ARROZ","ean":"7890000000011","quantity":"1","total":"23.90"},{"description":"CAFE","ean":"7890000000028","quantity":"1","total":"19.00"}]}'::jsonb) as p2 \gset
select public.confirm_purchase(:'p2') \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"MART  MINAS","store_cnpj":"11111111000111","purchased_at":"2026-10-20T10:00:00-03:00","total":"55.80","items":[{"description":"ARROZ","ean":"7890000000011","quantity":"2","total":"55.80"}]}'::jsonb) as p3 \gset
select public.confirm_purchase(:'p3') \gset
-- Rascunho não entra em nada
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Super BH","purchased_at":"2026-10-25T10:00:00-03:00","total":"999","items":[{"description":"ARROZ","ean":"7890000000011","quantity":"1","total":"999"}]}'::jsonb) as p4 \gset

-- ---------------------------------------------------------------------------
-- Visão financeira
-- ---------------------------------------------------------------------------
select public.intel_overview(:'hh', '2026-10-01', '2026-10-31') as ov \gset
select tests.eq((:'ov'::jsonb #>> '{kpis,total}')::numeric, 160.60, 'total gasto = soma dos comprovantes confirmados');
select tests.eq((:'ov'::jsonb #>> '{kpis,purchases}')::int, 3, '3 compras (rascunho fora)');
select tests.eq((:'ov'::jsonb #>> '{kpis,avg_ticket}')::numeric, 53.53, 'ticket médio = 160,60 / 3');
select tests.eq((:'ov'::jsonb #>> '{kpis,stores}')::int, 2, '2 mercados (mesmo CNPJ com nome diferente conta uma vez)');
select tests.eq((:'ov'::jsonb #>> '{kpis,products}')::int, 2, '2 produtos');
select tests.eq((:'ov'::jsonb #>> '{previous_kpis,total}')::numeric, 16.00, 'período anterior (set) = 16,00');
select tests.eq(:'ov'::jsonb ->> 'granularity', 'day', 'período de 31 dias agrupa por dia');
select tests.eq(jsonb_array_length(:'ov'::jsonb -> 'series'), 31, 'série com 31 dias (dias sem compra = 0)');
select tests.eq((select sum((x ->> 'total')::numeric) from jsonb_array_elements(:'ov'::jsonb -> 'series') x), 160.60, 'série soma o total');
select tests.eq((select sum((x ->> 'prev_total')::numeric) from jsonb_array_elements(:'ov'::jsonb -> 'series') x), 16.00, 'série traz o período anterior alinhado');
select tests.eq((select x ->> 'name' from jsonb_array_elements(:'ov'::jsonb -> 'categories') x limit 1), 'Mercearia', 'Mercearia lidera');
select tests.eq((select (x ->> 'share')::numeric from jsonb_array_elements(:'ov'::jsonb -> 'categories') x where x ->> 'name' = 'Mercearia'), 0.6575, 'participação = 105,60 / 160,60');
select tests.eq((select (x ->> 'change_pct') from jsonb_array_elements(:'ov'::jsonb -> 'categories') x where x ->> 'name' = 'Mercearia'), null, 'sem base anterior → variação nula (sem divisão por zero)');
select tests.eq((select (x ->> 'change_pct')::numeric from jsonb_array_elements(:'ov'::jsonb -> 'categories') x where x ->> 'name' = 'Bebidas'), 243.8, 'Bebidas: (55 − 16) / 16');
select tests.eq((:'ov'::jsonb #>> '{savings,total}')::numeric, 13.00, 'economia potencial = 2 + 8 + 3');
select tests.eq((select count(*) from jsonb_array_elements(:'ov'::jsonb -> 'tickets') x where (x ->> 'outlier')::boolean)::int, 0, 'poucas compras: nenhuma marcada como fora do padrão');

-- Filtro de categoria usa a soma das linhas
select public.intel_overview(:'hh', '2026-10-01', '2026-10-31', null, :'merc') as ovc \gset
select tests.eq((:'ovc'::jsonb #>> '{kpis,total}')::numeric, 105.60, 'filtro Mercearia: soma das linhas');
select tests.eq((:'ovc'::jsonb #>> '{kpis,purchases}')::int, 3, 'filtro Mercearia: compras que contêm a categoria');
-- Filtro de mercado
select public.intel_overview(:'hh', '2026-10-01', '2026-10-31', '22222222000122') as ovs \gset
select tests.eq((:'ovs'::jsonb #>> '{kpis,total}')::numeric, 42.90, 'filtro Super BH');
-- Período longo agrupa por mês
select tests.eq((public.intel_overview(:'hh', '2026-01-01', '2026-12-31')) ->> 'granularity', 'month', 'ano agrupa por mês');

-- ---------------------------------------------------------------------------
-- Supermercados e cesta comparável
-- ---------------------------------------------------------------------------
select public.intel_stores(:'hh', '2026-10-01', '2026-10-31') as st \gset
select tests.eq((:'st'::jsonb #>> '{ranking,0,store_key}'), '11111111000111', 'onde mais gastamos: Mart Minas');
select tests.eq((:'st'::jsonb #>> '{ranking,0,visits}')::int, 2, 'Mart Minas: 2 visitas');
select tests.eq((:'st'::jsonb #>> '{ranking,0,share}')::numeric, 0.7329, 'participação = 117,70 / 160,60');
select tests.eq(jsonb_array_length(:'st'::jsonb -> 'basket'), 2, 'cesta: 2 produtos comparáveis');
select tests.eq((select x ->> 'best_store_name' from jsonb_array_elements(:'st'::jsonb -> 'basket') x where x ->> 'product_name' = 'Arroz 5kg'), 'Super BH', 'arroz mais barato no Super BH (último preço)');
select tests.eq((select x ->> 'best_store_name' from jsonb_array_elements(:'st'::jsonb -> 'basket') x where x ->> 'product_name' = 'Café 500g'), 'Mart Minas', 'café mais barato no Mart Minas');
select tests.eq((:'st'::jsonb #>> '{price_index,0,store_key}'), '22222222000122', 'cesta mais econômica: Super BH (índice 1,0278)');
select tests.eq((:'st'::jsonb #>> '{price_index,0,index}')::numeric, 1.0278, 'índice = média(preço / menor preço)');
select tests.eq((select sum((x ->> 'saving')::numeric) from jsonb_array_elements(:'st'::jsonb -> 'savings') x), 13.00, 'economia por produto soma 13,00');

-- ---------------------------------------------------------------------------
-- Produtos: comprado × consumido × estoque
-- ---------------------------------------------------------------------------
select public.record_stock_movement(:'cafe', 'consumption', 1) \gset
select public.intel_products(:'hh', '2026-10-01', (now() at time zone 'America/Sao_Paulo')::date) as pr \gset
select tests.eq((select (x ->> 'quantity')::numeric from jsonb_array_elements(:'pr'::jsonb -> 'products') x where x ->> 'product_name' = 'Arroz 5kg'), 4.000, 'arroz: 4 comprados');
select tests.eq((select (x ->> 'receipts')::int from jsonb_array_elements(:'pr'::jsonb -> 'products') x where x ->> 'product_name' = 'Arroz 5kg'), 3, 'arroz: em 3 comprovantes');
select tests.eq((select (x ->> 'avg_interval_days')::numeric from jsonb_array_elements(:'pr'::jsonb -> 'products') x where x ->> 'product_name' = 'Arroz 5kg'), 7.5, 'arroz: intervalo médio 7,5 dias');
select tests.eq((select (x ->> 'avg_interval_days')::numeric from jsonb_array_elements(:'pr'::jsonb -> 'products') x where x ->> 'product_name' = 'Café 500g'), 16.0, 'café: intervalo usa o histórico completo (10/09, 05/10, 12/10)');
select tests.eq((select (x ->> 'consumed')::numeric from jsonb_array_elements(:'pr'::jsonb -> 'products') x where x ->> 'product_name' = 'Café 500g'), 1.000, 'consumo vem só do registro de consumo');
select tests.eq((select (x ->> 'current_qty')::numeric from jsonb_array_elements(:'pr'::jsonb -> 'products') x where x ->> 'product_name' = 'Café 500g'), 3.000, 'estoque atual separado (4 comprados − 1 consumido)');

-- ---------------------------------------------------------------------------
-- Preços
-- ---------------------------------------------------------------------------
select public.intel_prices(:'hh', '2026-10-01', '2026-10-31') as pc \gset
select tests.eq((select (x ->> 'avg_price')::numeric from jsonb_array_elements(:'pc'::jsonb) x where x ->> 'product_name' = 'Arroz 5kg'), 26.4000, 'média ponderada pela quantidade = 105,60 / 4');
select tests.eq((select (x ->> 'last_vs_prev_pct')::numeric from jsonb_array_elements(:'pc'::jsonb) x where x ->> 'product_name' = 'Arroz 5kg'), 16.7, 'arroz: 27,90 vs 23,90');
select tests.eq((select (x ->> 'period_change_pct')::numeric from jsonb_array_elements(:'pc'::jsonb) x where x ->> 'product_name' = 'Arroz 5kg'), 7.7, 'arroz: primeiro 25,90 → último 27,90');
select tests.eq((select (x ->> 'store_spread_pct')::numeric from jsonb_array_elements(:'pc'::jsonb) x where x ->> 'product_name' = 'Arroz 5kg'), 16.7, 'diferença entre mercados');
select tests.eq((select (x ->> 'vs_prev_period_pct')::numeric from jsonb_array_elements(:'pc'::jsonb) x where x ->> 'product_name' = 'Café 500g'), 14.6, 'café: média out (18,33) vs set (16,00)');
select tests.eq((select count(*) from public.intel_price_history(:'hh', :'arroz', '2026-01-01', '2026-12-31'))::int, 3, 'histórico do arroz: 3 compras');

-- ---------------------------------------------------------------------------
-- Opções de filtro, validações e isolamento
-- ---------------------------------------------------------------------------
select public.intel_filter_options(:'hh') as fo \gset
select tests.eq(jsonb_array_length(:'fo'::jsonb -> 'stores'), 2, 'filtro: 2 mercados');
select tests.eq(jsonb_array_length(:'fo'::jsonb -> 'brands'), 2, 'filtro: 2 marcas');
select tests.eq((:'fo'::jsonb ->> 'drafts')::int, 1, 'informa rascunhos pendentes');
select tests.expect_error(format($$ select public.intel_overview(%L, '2026-10-31', '2026-10-01') $$, :'hh'), 'Período inválido');

select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.intel_overview(%L, '2026-10-01', '2026-10-31') $$, :'hh'), 'não encontrada');
select tests.expect_error(format($$ select public.intel_stores(%L, '2026-10-01', '2026-10-31') $$, :'hh'), 'não encontrada');
select tests.expect_error(format($$ select * from public.intel_price_history(%L, %L, '2026-10-01', '2026-10-31') $$, :'hh', :'arroz'), 'não encontrada');
select tests.expect_error(format($$ select public.intel_filter_options(%L) $$, :'hh'), 'não encontrada');

\echo 'Inteligência de compras: todos os testes passaram.'
