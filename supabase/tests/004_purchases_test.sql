-- Testes da Fase 4: comprovantes, revisão, confirmação, preços e aprendizado.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com',  '{"full_name":"Diogo"}'),
  ('00000000-0000-0000-0000-00000000000b', 'leitor@example.com', '{"full_name":"Leitor"}'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com',  '{"full_name":"Outra"}');

set role authenticated;

select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh_a \gset
select public.create_household_invite(:'hh_a', 'viewer') as tok \gset
select tests.login('00000000-0000-0000-0000-00000000000b');
select public.accept_household_invite(:'tok') \gset
select tests.login('00000000-0000-0000-0000-00000000000c');
select public.create_household('Casa C') as hh_c \gset
select public.create_tracked_product(:'hh_c', 'Produto C') as prod_c \gset

select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_tracked_product(:'hh_a', 'Ketchup Zero', 'Bonare', null, null, 380, 'g', '7896000000017', null, 3, 1) as ketchup \gset
select public.create_tracked_product(:'hh_a', 'Café', 'Melitta', null, null, 500, 'g', null, null, 2, 0) as cafe \gset
select public.create_tracked_product(:'hh_a', 'Banana', null, null, null, null, 'un', null, null, 1, 0) as banana \gset

-- Abre a lista (café entra com origem stock, sem preço)
select list_id as list from public.generate_shopping_list(:'hh_a') \gset
select tests.eq((select estimated_unit_price from public.shopping_list_items where household_product_id = :'cafe')::text,
                null::text, 'sem histórico, lista sem preço');

-- ---------------------------------------------------------------------------
-- Rascunho a partir dos dados extraídos
-- ---------------------------------------------------------------------------
\set receipt '{"store_name":"Supermercado Exemplo","store_cnpj":"12.345.678/0001-90","purchased_at":"2026-11-07T18:30:00-03:00","access_key":"35261112345678000190650010000123451000123456","total":"41.36","discount":"1.00","items":[{"description":"KETCHUP BONARE ZERO 380G","ean":"7896000000017","quantity":"2","unit":"UN","unit_price":"8.99","discount":"0","total":"17.98"},{"description":"CAFE MELITTA TRAD 500G","ean":"7891021006125","quantity":"1","unit":"UN","unit_price":"19.90","discount":"1.00","total":"18.90"},{"description":"BANANA PRATA KG","ean":"","quantity":"0.640","unit":"KG","unit_price":"7.00","total":"4.48"},{"description":"SACOLA PLASTICA","quantity":"1","unit":"UN","unit_price":"0","total":"0"}]}'

select public.create_purchase_draft(:'hh_a', 'nfce_qrcode', :'receipt'::jsonb) as p1 \gset
select tests.eq((select status::text from public.purchases where id = :'p1'), 'draft', 'leitura cria rascunho');
select tests.eq((select store_cnpj from public.purchases where id = :'p1'), '12345678000190', 'CNPJ normalizado');
select tests.eq((select count(*) from public.purchase_items where purchase_id = :'p1')::int, 4, 'todos os itens extraídos');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 1.000::numeric,
                'RASCUNHO NÃO ALTERA O ESTOQUE');
select tests.eq((select household_product_id from public.purchase_items where purchase_id = :'p1' and line_number = 1)::text,
                :'ketchup'::text, 'ketchup associado pelo código de barras');
select tests.eq((select match_source from public.purchase_items where purchase_id = :'p1' and line_number = 1), 'barcode', 'origem: barcode');
select tests.eq((select household_product_id from public.purchase_items where purchase_id = :'p1' and line_number = 2)::text,
                null::text, 'café sem associação na primeira vez');
select tests.eq((select stock_quantity from public.purchase_items where purchase_id = :'p1' and line_number = 3), 1.000::numeric,
                'item por peso entra como 1 embalagem');
select tests.eq((select stock_quantity from public.purchase_items where purchase_id = :'p1' and line_number = 1), 2.000::numeric,
                'item por unidade entra pela quantidade');

-- Importar o mesmo cupom de novo não duplica
select tests.eq((select public.create_purchase_draft(:'hh_a', 'nfce_qrcode', :'receipt'::jsonb))::text, :'p1'::text,
                'mesma chave de acesso devolve a compra existente');
select tests.eq((select count(*) from public.purchases where household_id = :'hh_a')::int, 1, 'sem compra duplicada');

-- Validações
select tests.expect_error(format($$ select public.create_purchase_draft(%L, 'xml', '{"items":[]}') $$, :'hh_a'), 'Nenhum item');

-- ---------------------------------------------------------------------------
-- Revisão
-- ---------------------------------------------------------------------------
select id as it_cafe from public.purchase_items where purchase_id = :'p1' and line_number = 2 \gset
select id as it_banana from public.purchase_items where purchase_id = :'p1' and line_number = 3 \gset
select id as it_sacola from public.purchase_items where purchase_id = :'p1' and line_number = 4 \gset
select id as it_ketchup from public.purchase_items where purchase_id = :'p1' and line_number = 1 \gset

select public.update_purchase_item(:'it_cafe', :'cafe', true, false, 1);
select public.update_purchase_item(:'it_banana', :'banana', true, false, 6);  -- 6 bananas
select public.update_purchase_item(:'it_sacola', null, false, true, 0);       -- não é produto de estoque
select tests.eq((select match_source from public.purchase_items where id = :'it_cafe'), 'user', 'associação manual registrada');
select tests.expect_error(format($$ select public.update_purchase_item(%L, %L, true, false, 1) $$, :'it_cafe', :'prod_c'),
                          'outra família');
select tests.expect_error(format($$ select public.update_purchase_item(%L, %L, true, false, -1) $$, :'it_cafe', :'cafe'),
                          'inválida');

-- Leitor e outra família não mexem
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.eq((select count(*) from public.purchase_items where purchase_id = :'p1')::int, 4, 'leitor vê a compra');
select tests.expect_error(format($$ select public.confirm_purchase(%L) $$, :'p1'), 'não encontrada');
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.eq((select count(*) from public.purchases)::int, 0, 'C não vê compras de A');
select tests.expect_error(format($$ select public.update_purchase_item(%L, null, false, true, 0) $$, :'it_cafe'), 'não encontrada');
select tests.expect_error(format($$ select public.create_purchase_draft(%L, 'xml', %L::jsonb) $$, :'hh_a', :'receipt'), 'permissão');

-- ---------------------------------------------------------------------------
-- Confirmação
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');
select applied_items from public.confirm_purchase(:'p1') \gset
select tests.eq(:'applied_items'::int, 3, 'três itens lançados (sacola ignorada)');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 3.000::numeric, 'ketchup 1 + 2 = 3');
select tests.eq((select current_qty from public.household_products where id = :'cafe'), 1.000::numeric, 'café 0 + 1');
select tests.eq((select current_qty from public.household_products where id = :'banana'), 6.000::numeric, 'banana 0 + 6');
select tests.eq((select count(*) from public.stock_movements where source = 'purchase' and source_id = :'p1')::int, 3,
                'movimentações vinculadas à compra');

-- Idempotente
select applied_items as again from public.confirm_purchase(:'p1') \gset
select tests.eq(:'again'::int, 0, 'confirmar de novo não lança nada');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 3.000::numeric, 'sem duplicar estoque');
select tests.expect_error(format($$ select public.update_purchase_item(%L, null, false, true, 0) $$, :'it_cafe'), 'confirmada');
select tests.expect_error(format($$ select public.discard_purchase(%L) $$, :'p1'), 'confirmada');

-- Preços
select tests.eq((select unit_cost from public.purchase_items where id = :'it_cafe'), 18.9000::numeric, 'custo do café com desconto');
select tests.eq((select unit_cost from public.purchase_items where id = :'it_banana'), 0.7467::numeric,
                'custo por banana = 4,48 / 6');
select tests.eq((select last_price from public.household_product_prices where household_product_id = :'ketchup'), 8.9900::numeric,
                'último preço do ketchup');

-- Lista: café marcado sozinho e preço preenchido
select tests.eq((select checked_at is not null from public.shopping_list_items where household_product_id = :'cafe'), true,
                'item comprado é marcado na lista aberta');
select tests.eq((select estimated_unit_price from public.shopping_list_items where household_product_id = :'cafe'), 18.90::numeric,
                'preço vazio da lista preenchido com o último pago');

-- ---------------------------------------------------------------------------
-- Aprendizado: próxima compra associa sozinha pela descrição
-- ---------------------------------------------------------------------------
\set receipt2 '{"store_name":"Supermercado Exemplo","store_cnpj":"12345678000190","purchased_at":"2026-11-14T10:00:00-03:00","access_key":"35261112345678000190650010000999991000999999","items":[{"description":"Café Melitta Trad 500g","quantity":"2","unit":"UN","unit_price":"21.50","total":"43.00"},{"description":"PRODUTO NOVO XYZ","quantity":"1","unit":"UN","unit_price":"5","total":"5"}]}'
select public.create_purchase_draft(:'hh_a', 'nfce_qrcode', :'receipt2'::jsonb) as p2 \gset
select tests.eq((select household_product_id from public.purchase_items where purchase_id = :'p2' and line_number = 1)::text,
                :'cafe'::text, 'descrição aprendida associa automaticamente (sem acento/maiúsculas)');
select tests.eq((select match_source from public.purchase_items where purchase_id = :'p2' and line_number = 1),
                'alias_description', 'origem: apelido de descrição');

-- Descartar rascunho
select public.discard_purchase(:'p2');
select tests.eq((select status::text from public.purchases where id = :'p2'), 'discarded', 'rascunho descartado');
select tests.eq((select current_qty from public.household_products where id = :'cafe'), 1.000::numeric, 'descartar não altera estoque');
-- Descartado pode ser importado de novo
select tests.eq((select public.create_purchase_draft(:'hh_a', 'nfce_qrcode', :'receipt2'::jsonb))::text <> :'p2'::text, true,
                'comprovante descartado pode ser reimportado');

-- ---------------------------------------------------------------------------
-- Aviso de possível duplicidade com lista finalizada
-- ---------------------------------------------------------------------------
select list_id as list2 from public.generate_shopping_list(:'hh_a') \gset
select public.add_product_to_list(:'list2', :'ketchup', 1) \gset
select public.set_list_item_checked((select id from public.shopping_list_items where list_id = :'list2' and household_product_id = :'ketchup'), true);
select public.complete_shopping_list(:'list2', true) \gset
\set receipt3 '{"items":[{"description":"KETCHUP","ean":"7896000000017","quantity":"1","unit":"UN","total":"8.99"}]}'
select public.create_purchase_draft(:'hh_a', 'manual', :'receipt3'::jsonb) as p3 \gset
select tests.eq((select received from public.purchase_items where purchase_id = :'p3'), false,
                'item já lançado por lista recente vem desmarcado');
select tests.eq((select hint is not null from public.purchase_items where purchase_id = :'p3'), true, 'com aviso explicativo');

-- ---------------------------------------------------------------------------
-- Arquivos e Storage
-- ---------------------------------------------------------------------------
select public.register_purchase_file(:'hh_a', :'hh_a' || '/abc.jpg', 'image/jpeg', 1000, repeat('a', 64)) as f1 \gset
select tests.expect_error(
  format($$ select public.register_purchase_file(%L, %L, 'image/jpeg', 1000, %L) $$, :'hh_a', :'hh_c' || '/x.jpg', repeat('b', 64)),
  'Caminho de arquivo inválido');
select tests.expect_error(
  format($$ select public.register_purchase_file(%L, %L, 'application/pdf', 1000, %L) $$, :'hh_a', :'hh_a' || '/x.pdf', repeat('c', 64)),
  'purchase_files_mime_type_check');
\set photo '{"items":[{"description":"ARROZ","quantity":"1","total":"25"}]}'
select public.create_purchase_draft(:'hh_a', 'photo', :'photo'::jsonb, :'f1') as p4 \gset
select tests.eq((select public.create_purchase_draft(:'hh_a', 'photo', :'photo'::jsonb, :'f1'))::text, :'p4'::text,
                'mesmo arquivo (hash) não cria compra duplicada');
select tests.eq((select purchase_id from public.purchase_files where id = :'f1')::text, :'p4'::text, 'arquivo original vinculado');

insert into storage.objects (bucket_id, name) values ('receipts', :'hh_a' || '/ok.jpg');
select tests.expect_error(format($$ insert into storage.objects (bucket_id, name) values ('receipts', %L) $$, :'hh_c' || '/x.jpg'),
                          'row-level security');
select tests.expect_error($$ insert into storage.objects (bucket_id, name) values ('receipts', 'nao-e-uuid/x.jpg') $$,
                          'row-level security');
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.eq((select count(*) from storage.objects where bucket_id = 'receipts')::int, 0, 'C não lê arquivos de A');
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.eq((select count(*) from storage.objects where bucket_id = 'receipts')::int, 1, 'leitor lê arquivos da família');
select tests.expect_error(format($$ insert into storage.objects (bucket_id, name) values ('receipts', %L) $$, :'hh_a' || '/y.jpg'),
                          'row-level security');

\echo 'Fase 4: todos os testes passaram.'
