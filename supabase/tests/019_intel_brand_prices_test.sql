-- Testes: preços por marca/apresentação dentro do produto genérico.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select public.create_tracked_product(:'hh', 'Pão de forma', null, null, null, null, 'un', null, null, 2, 0) as pao \gset

-- Mart Minas: Seven Boys 450g a 6,98 (05/10) e 7,49 (20/10); Wickbold 500g a 8,99 (12/10)
-- Super BH:   Seven Boys 450g a 6,49 (15/10)
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","store_cnpj":"11111111000111","purchased_at":"2026-10-05T10:00:00-03:00","items":[{"description":"PAO FORMA SEVEN BOYS 450G LEITE","ean":"7891193010081","quantity":"1","total":"6.98"}]}'::jsonb) as p1 \gset
select public.confirm_purchase(:'p1') \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","store_cnpj":"11111111000111","purchased_at":"2026-10-12T10:00:00-03:00","items":[{"description":"PAO FORMA WICKBOLD 500G","ean":"7896066300011","quantity":"1","total":"8.99"}]}'::jsonb) as p2 \gset
select public.confirm_purchase(:'p2') \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Super BH","store_cnpj":"22222222000122","purchased_at":"2026-10-15T10:00:00-03:00","items":[{"description":"PAO DE FORMA SEVEN BOYS LEITE 450G","ean":"7891193010081","quantity":"1","total":"6.49"}]}'::jsonb) as p3 \gset
select public.confirm_purchase(:'p3') \gset
select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","store_cnpj":"11111111000111","purchased_at":"2026-10-20T10:00:00-03:00","items":[{"description":"PAO FORMA SEVEN BOYS 450G LEITE","ean":"7891193010081","quantity":"1","total":"7.49"}]}'::jsonb) as p4 \gset
select public.confirm_purchase(:'p4') \gset

select tests.eq((select count(distinct household_product_id) from public.purchase_items)::int, 1, 'as duas marcas estão no mesmo produto genérico');

-- Tamanho na descrição
reset role;
select tests.eq((select qty || base from private.parse_size('PAO FORMA SEVEN BOYS 450G LEITE')), '0.45kg', '450G → 0,45 kg');
select tests.eq((select qty || base from private.parse_size('BATATA PALITO 1,5KG CONG')), '1.5kg', '1,5KG');
select tests.eq((select qty || base from private.parse_size('SABAO BARRA YPE 160G C/5 COCO')), '0.8kg', 'C/5 multiplica');
select tests.eq((select qty || base from private.parse_size('AGUA MINERAL CRYSTAL 500ML C/GAS CX12')), '6L', 'CX12 multiplica (fardo = 6 L)');
select tests.eq((select qty from private.parse_size('FLV OVO VERM HAPPY EGGS C/20')), null::numeric, 'sem tamanho → nulo');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');

-- Preços: uma linha por marca
select public.intel_prices(:'hh', '2026-10-01', '2026-10-31') as pc \gset
select tests.eq(jsonb_array_length(:'pc'::jsonb), 2, 'duas variantes (Seven Boys e Wickbold)');
select tests.eq((select (x ->> 'last_vs_prev_pct')::numeric from jsonb_array_elements(:'pc'::jsonb) x where x ->> 'variant_label' like '%SEVEN%'), 15.4,
                'variação compara Seven Boys com Seven Boys (7,49 vs 6,49), não com a Wickbold');
select tests.eq((select (x ->> 'price_per_base')::numeric from jsonb_array_elements(:'pc'::jsonb) x where x ->> 'variant_label' like '%WICKBOLD%'), 17.98,
                'Wickbold: 8,99 / 0,5 kg = 17,98/kg');
select tests.eq((select x ->> 'base_unit' from jsonb_array_elements(:'pc'::jsonb) x where x ->> 'variant_label' like '%WICKBOLD%'), 'kg', 'base kg');
select tests.eq((select (x ->> 'store_spread_pct')::numeric from jsonb_array_elements(:'pc'::jsonb) x where x ->> 'variant_label' like '%SEVEN%'), 15.4,
                'diferença entre mercados só da Seven Boys');

-- Comparador: só a mesma marca
select public.intel_stores(:'hh', '2026-10-01', '2026-10-31') as st \gset
select tests.eq(jsonb_array_length(:'st'::jsonb -> 'basket'), 1, 'cesta: só Seven Boys (comprada nos dois mercados)');
select tests.eq(:'st'::jsonb #>> '{basket,0,best_store_name}', 'Super BH', 'Seven Boys mais barata no Super BH');
select tests.eq((select sum((x ->> 'saving')::numeric) from jsonb_array_elements(:'st'::jsonb -> 'savings') x), 1.49,
                'economia: só Seven Boys (6,98−6,49 + 7,49−6,49); Wickbold não é comparada com Seven Boys');

-- Histórico traz a variante de cada compra
select tests.eq((select count(distinct variant_key) from public.intel_price_history(:'hh', :'pao', '2026-10-01', '2026-10-31'))::int, 2, 'histórico com 2 variantes');

\echo 'Preços por marca: todos os testes passaram.'
