-- Testes da Fase 5: inventário por fotografias.
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
select id as loc_c from public.locations where household_id = :'hh_c' limit 1 \gset

select tests.login('00000000-0000-0000-0000-00000000000a');
select id as desp from public.locations where household_id = :'hh_a' and name = 'Despensa' \gset
select public.create_tracked_product(:'hh_a', 'Ketchup Zero', 'Bonare', null, null, null, 'un', null, :'desp', 3, 1) as ketchup \gset
select public.create_tracked_product(:'hh_a', 'Sardinha', 'Coqueiro', null, null, null, 'un', null, :'desp', 6, 4) as sardinha \gset
select public.create_tracked_product(:'hh_a', 'Arroz', 'Tio João', null, null, null, 'un', null, :'desp', 1, 1) as arroz \gset
select public.create_tracked_product(:'hh_a', 'Café', 'Melitta', null, null, null, 'un', null, :'desp', 2, 1) as cafe \gset

-- ---------------------------------------------------------------------------
-- Criar conferência e registrar fotos
-- ---------------------------------------------------------------------------
select public.create_inventory_scan(:'hh_a', :'desp') as scan \gset
select tests.expect_error(format($$ select public.create_inventory_scan(%L, %L) $$, :'hh_a', :'loc_c'), 'outra família');
select public.register_inventory_photo(:'scan', 1, :'hh_a' || '/scans/1.jpg', 'image/jpeg', 2000, repeat('a', 64)) \gset
select public.register_inventory_photo(:'scan', 2, :'hh_a' || '/scans/2.jpg', 'image/jpeg', 2000, repeat('b', 64)) \gset
select tests.expect_error(
  format($$ select public.register_inventory_photo(%L, 3, %L, 'image/jpeg', 10, %L) $$, :'scan', :'hh_c' || '/x.jpg', repeat('c', 64)),
  'Caminho de arquivo inválido');
select tests.eq((select count(*) from public.inventory_scan_files where scan_id = :'scan')::int, 2, 'duas fotos registradas');

-- ---------------------------------------------------------------------------
-- Detecções
-- ---------------------------------------------------------------------------
select public.save_inventory_detections(:'scan', jsonb_build_array(
  jsonb_build_object('name', 'Ketchup', 'brand', 'Bonare', 'quantity', 2, 'confidence', 0.93, 'photos', jsonb_build_array(1), 'product_id', :'ketchup'),
  jsonb_build_object('name', 'Sardinha em lata', 'brand', 'Coqueiro', 'quantity', 5, 'confidence', 0.6, 'partially_hidden', true, 'product_id', :'sardinha'),
  jsonb_build_object('name', 'Biscoito recheado', 'brand', null, 'quantity', null, 'confidence', 0.4),
  jsonb_build_object('name', 'Intruso', 'quantity', 9, 'confidence', 0.99, 'product_id', :'prod_c')
), 'gemini-test') as n \gset

select tests.eq(:'n'::int, 4, 'quatro detecções gravadas');
select tests.eq((select status::text from public.inventory_scan_items where scan_id = :'scan' and household_product_id = :'ketchup'),
                'confirmed', 'alta confiança + visível + produto conhecido entra pré-confirmado');
select tests.eq((select status::text from public.inventory_scan_items where scan_id = :'scan' and household_product_id = :'sardinha'),
                'pending', 'parcialmente escondido exige confirmação manual');
select tests.eq((select estimated_quantity from public.inventory_scan_items where scan_id = :'scan' and detected_name = 'Biscoito recheado')::text,
                null::text, 'quantidade não identificada fica vazia (não inventa)');
select tests.eq((select household_product_id from public.inventory_scan_items where scan_id = :'scan' and detected_name = 'Intruso')::text,
                null::text, 'produto de outra família indicado pela IA é descartado');
select tests.eq((select status::text from public.inventory_scan_items where scan_id = :'scan' and detected_name = 'Intruso'),
                'pending', 'sem produto, fica pendente');
select tests.eq((select count(*) from public.inventory_scan_items where scan_id = :'scan' and origin = 'expected')::int, 2,
                'arroz e café (esperados na despensa) listados como não vistos');
select tests.eq((select system_quantity from public.inventory_scan_items where scan_id = :'scan' and household_product_id = :'ketchup'),
                1.000::numeric, 'quantidade do sistema registrada para comparação');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 1.000::numeric,
                'ANÁLISE NÃO ALTERA O ESTOQUE');

-- Reprocessar substitui (não duplica)
select public.save_inventory_detections(:'scan', jsonb_build_array(
  jsonb_build_object('name', 'Ketchup', 'brand', 'Bonare', 'quantity', 2, 'confidence', 0.93, 'photos', jsonb_build_array(1), 'product_id', :'ketchup'),
  jsonb_build_object('name', 'Sardinha em lata', 'brand', 'Coqueiro', 'quantity', 5, 'confidence', 0.6, 'partially_hidden', true, 'product_id', :'sardinha'),
  jsonb_build_object('name', 'Biscoito recheado', 'quantity', null, 'confidence', 0.4)
), 'gemini-test') \gset
select tests.eq((select count(*) from public.inventory_scan_items where scan_id = :'scan')::int, 5, 'reprocessar substitui o resultado');

-- ---------------------------------------------------------------------------
-- Revisão
-- ---------------------------------------------------------------------------
select id as it_sard from public.inventory_scan_items where scan_id = :'scan' and household_product_id = :'sardinha' \gset
select id as it_bisc from public.inventory_scan_items where scan_id = :'scan' and detected_name = 'Biscoito recheado' \gset
select id as it_arroz from public.inventory_scan_items where scan_id = :'scan' and household_product_id = :'arroz' \gset
select id as it_cafe from public.inventory_scan_items where scan_id = :'scan' and household_product_id = :'cafe' \gset

select tests.expect_error(format($$ select public.update_inventory_item(%L, null, 3, 'confirmed') $$, :'it_bisc'), 'escolha o produto');
select tests.expect_error(format($$ select public.update_inventory_item(%L, %L, null, 'confirmed') $$, :'it_sard', :'sardinha'), 'informe a quantidade');
select tests.expect_error(format($$ select public.update_inventory_item(%L, %L, 1, 'confirmed') $$, :'it_bisc', :'prod_c'), 'outra família');
select public.update_inventory_item(:'it_sard', :'sardinha', 4, 'confirmed');      -- usuário corrige: 4
select public.update_inventory_item(:'it_bisc', null, null, 'ignored');            -- não é controlado
select public.update_inventory_item(:'it_arroz', :'arroz', 0, 'confirmed');        -- acabou
-- café: continua pendente (estava escondido atrás de algo) → não muda

-- Permissões
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.eq((select count(*) from public.inventory_scan_items where scan_id = :'scan')::int, 5, 'leitor vê a conferência');
select tests.expect_error(format($$ select public.confirm_inventory_scan(%L) $$, :'scan'), 'não encontrada');
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.eq((select count(*) from public.inventory_scans)::int, 0, 'C não vê conferências de A');
select tests.expect_error(format($$ select public.update_inventory_item(%L, null, null, 'ignored') $$, :'it_bisc'), 'não encontrada');

-- ---------------------------------------------------------------------------
-- Confirmação
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');
select adjusted_items from public.confirm_inventory_scan(:'scan') \gset
select tests.eq(:'adjusted_items'::int, 2, 'ketchup (1→2) e arroz (1→0) ajustados; sardinha já era 4');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 2.000::numeric, 'ketchup = 2 contados');
select tests.eq((select current_qty from public.household_products where id = :'sardinha'), 4.000::numeric, 'sardinha = 4 (corrigido pelo usuário)');
select tests.eq((select current_qty from public.household_products where id = :'arroz'), 0.000::numeric, 'arroz = 0 (acabou)');
select tests.eq((select current_qty from public.household_products where id = :'cafe'), 1.000::numeric, 'item pendente não muda');
select tests.eq((select count(*) from public.stock_movements where source = 'inventory_scan' and type = 'inventory_adjustment')::int, 2,
                'ajustes de inventário com origem identificável');

select adjusted_items as again from public.confirm_inventory_scan(:'scan') \gset
select tests.eq(:'again'::int, 0, 'confirmar de novo é idempotente');
select tests.expect_error(format($$ select public.update_inventory_item(%L, null, null, 'ignored') $$, :'it_bisc'), 'confirmada');

-- Saldo continua igual ao histórico
select tests.eq(
  (select bool_and(hp.current_qty = coalesce((select sum(m.quantity_delta) from public.stock_movements m where m.household_product_id = hp.id), 0))
     from public.household_products hp where hp.household_id = :'hh_a'),
  true, 'saldo = soma das movimentações após a conferência');

-- ---------------------------------------------------------------------------
-- Aprendizado: próxima conferência associa pelo nome que a IA usou
-- ---------------------------------------------------------------------------
select public.create_inventory_scan(:'hh_a', null) as scan2 \gset
select public.save_inventory_detections(:'scan2', jsonb_build_array(
  jsonb_build_object('name', 'Sardinha em lata', 'brand', 'Coqueiro', 'quantity', 3, 'confidence', 0.9)
)) \gset
select tests.eq((select household_product_id from public.inventory_scan_items where scan_id = :'scan2')::text, :'sardinha'::text,
                'nome aprendido associa automaticamente');
select tests.eq((select count(*) from public.inventory_scan_items where scan_id = :'scan2' and origin = 'expected')::int, 0,
                'sem ambiente, não lista esperados');
select public.discard_inventory_scan(:'scan2');
select tests.eq((select status::text from public.inventory_scans where id = :'scan2'), 'discarded', 'conferência descartada');

-- Storage do bucket de fotos segue a regra de pasta = família
insert into storage.objects (bucket_id, name) values ('inventory-photos', :'hh_a' || '/scans/ok.jpg');
select tests.expect_error(format($$ insert into storage.objects (bucket_id, name) values ('inventory-photos', %L) $$, :'hh_c' || '/x.jpg'),
                          'row-level security');

\echo 'Fase 5: todos os testes passaram.'
