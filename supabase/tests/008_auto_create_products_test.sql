-- Testes: cadastro automático de produtos ao confirmar uma compra.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com', '{"full_name":"Diogo"}');

set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select public.create_tracked_product(:'hh', 'Ketchup', 'Bonare', null, 'Zero', 390, 'g', '7896000000017') as ketchup \gset

\set nota '{"store_name":"Mercado","store_cnpj":"11111111000111","purchased_at":"2026-11-05T10:00:00-03:00","items":[{"description":"KETCHUP BONARE 390G ZERO","ean":"7896000000017","quantity":"1","total":"8.99"},{"description":"AZEITE ANDORINHA 500ML EXT VIRG VD","ean":"5601252001114","quantity":"1","total":"31.90"},{"description":"SARD COQUEIRO 125G TOM","quantity":"1","total":"6.49"},{"description":"SARD COQUEIRO 125G TOM","quantity":"1","total":"6.49"},{"description":"FLV BANANA PRATA KG","quantity":"0.97","unit":"KG","total":"3.85"},{"description":"DESOD CR REXONA 58G CLINICAL","quantity":"1","total":"33.98"},{"description":"AMAC ROUPA CONC DOWNY 3L","quantity":"1","total":"65.90"},{"description":"SACOLA PLASTICA","quantity":"1","total":"0.10"},{"description":"SUCO PANIZZON 100% 1,350L UVA","quantity":"2","total":"29.80"}]}'

select public.create_purchase_draft(:'hh', 'nfce_qrcode', :'nota'::jsonb) as p1 \gset
select tests.eq((select count(*) from public.household_products)::int, 1, 'leitura NÃO cadastra produtos (só a confirmação)');

-- Sacola: usuário marca como ignorada
select public.update_purchase_item((select id from public.purchase_items where description = 'SACOLA PLASTICA'), null, false, true, 0);

select applied_items from public.confirm_purchase(:'p1') \gset
select tests.eq((select count(*) from public.household_products)::int, 7,
                '6 produtos novos (sardinha repetida vira um só; sacola ignorada não)');
select tests.eq((select count(*) from public.purchase_items where purchase_id = :'p1' and household_product_id is null and not ignored)::int, 0,
                'todos os itens não ignorados ficaram associados');
select tests.eq((select count(*) from public.purchase_items where purchase_id = :'p1' and match_source = 'auto')::int, 7,
                'origem da associação registrada como automática');
select tests.eq(:'applied_items'::int, 8, 'oito linhas lançadas no estoque');

-- Nomes, embalagens e categorias
select tests.eq((select product_name || '|' || trim_scale(package_size)::text || '|' || unit::text || '|' || category_name
                   from public.household_stock where barcode = '5601252001114'),
                'Azeite Andorinha Ext Virg Vd|500|ml|Mercearia', 'azeite: nome, 500 ml, mercearia e EAN');
select tests.eq((select current_qty from public.household_stock where product_name = 'Sard Coqueiro Tom'), 2.000::numeric,
                'sardinha: duas linhas somam 2 no estoque');
select tests.eq((select category_name || '|' || coalesce(presentation, '') || '|' || coalesce(package_size::text, '-')
                   from public.household_stock where product_name = 'Banana Prata'),
                'Hortifruti|Granel (kg)|-', 'banana: hortifruti, granel, sem embalagem fixa');
select tests.eq((select category_name from public.household_stock where product_name like 'Desod%'), 'Higiene pessoal', 'desodorante: higiene');
select tests.eq((select category_name || '|' || trim_scale(package_size)::text || unit::text from public.household_stock where product_name like 'Amac%'),
                'Lavanderia|3l', 'amaciante: lavanderia, 3 L');
select tests.eq((select category_name || '|' || trim_scale(package_size)::text || unit::text || '|' || trim_scale(ideal_qty)::text
                   from public.household_stock where product_name like 'Suco%'),
                'Bebidas|1.35l|2', 'suco: bebidas, 1,35 L, quanto manter = quantidade comprada');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 1.000::numeric,
                'produto já existente segue associado normalmente');

-- Próxima compra associa sozinha os produtos criados
\set nota2 '{"store_name":"Mercado","store_cnpj":"11111111000111","purchased_at":"2026-11-20T10:00:00-03:00","items":[{"description":"SARD COQUEIRO 125G TOM","quantity":"1","total":"6.49"},{"description":"AZEITE ANDORINHA 500ML","ean":"5601252001114","quantity":"1","total":"30.90"}]}'
select public.create_purchase_draft(:'hh', 'nfce_qrcode', :'nota2'::jsonb) as p2 \gset
select tests.eq((select count(*) from public.purchase_items where purchase_id = :'p2' and household_product_id is not null)::int, 2,
                'próxima compra reconhece os produtos criados (descrição e EAN aprendidos)');

-- Rascunho descartado não cria nada
\set nota3 '{"purchased_at":"2026-11-21T10:00:00-03:00","items":[{"description":"PRODUTO DESCARTADO 1KG","quantity":"1","total":"5"}]}'
select public.create_purchase_draft(:'hh', 'manual', :'nota3'::jsonb) as p3 \gset
select public.discard_purchase(:'p3');
select tests.eq((select count(*) from public.household_stock where product_name like 'Produto Descartado%')::int, 0,
                'rascunho descartado não cadastra produtos');

-- Compra antiga (itens desmarcados) cadastra o produto, mas não mexe no estoque
\set nota4 '{"purchased_at":"2026-08-01T10:00:00-03:00","items":[{"description":"GRANOLA TIA SONIA 800G","quantity":"1","total":"44.90"}]}'
select public.create_purchase_draft(:'hh', 'manual', :'nota4'::jsonb) as p4 \gset
select public.update_purchase_item((select id from public.purchase_items where purchase_id = :'p4'), null, false, false, 1);
select public.confirm_purchase(:'p4') \gset
select tests.eq((select trim_scale(current_qty)::text || '|' || trim_scale(package_size)::text || unit::text
                   from public.household_stock where product_name = 'Granola Tia Sonia'),
                '0|800g', 'produto cadastrado sem somar ao estoque quando não recebido');
select tests.eq((select count(*) from public.product_price_history where description like 'GRANOLA%')::int, 1,
                'preço da compra antiga entra no histórico');

\echo 'Cadastro automático: todos os testes passaram.'
