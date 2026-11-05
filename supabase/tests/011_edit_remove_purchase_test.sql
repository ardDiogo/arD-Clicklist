-- Testes: editar (reabrir) e remover compras confirmadas.
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
select public.create_tracked_product(:'hh', 'Ketchup', null, null, null, null, 'un', '7896000000017', null, 3, 1) as ketchup \gset
select public.create_tracked_product(:'hh', 'Café', null, null, null, null, 'un', null, null, 2, 0) as cafe \gset

select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","purchased_at":"2026-11-05T10:00:00-03:00","items":[{"description":"KETCHUP","ean":"7896000000017","quantity":"2","total":"17.98"},{"description":"CAFE","quantity":"1","total":"21.98"}]}'::jsonb) as p \gset
select public.update_purchase_item((select id from public.purchase_items where purchase_id = :'p' and description = 'CAFE'), :'cafe', true, false, 1);
select public.confirm_purchase(:'p') \gset
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 3.000::numeric, 'ketchup 1 + 2 = 3');
select tests.eq((select current_qty from public.household_products where id = :'cafe'), 1.000::numeric, 'café 0 + 1 = 1');

-- Consumiu 1 café antes de editar (estorno não pode deixar negativo)
select public.record_stock_movement(:'cafe', 'consumption', 1) \gset

-- ---------------------------------------------------------------------------
-- Editar: reabre, estorna, corrige e confirma de novo
-- ---------------------------------------------------------------------------
select public.reopen_purchase(:'p') as reverted \gset
select tests.eq(:'reverted'::int, 1, 'estornou só o ketchup (café já consumido, estoque 0)');
select tests.eq((select status::text || '|' || revision::text from public.purchases where id = :'p'), 'draft|1', 'compra volta a rascunho, revisão 1');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 1.000::numeric, 'ketchup volta para 1');
select tests.eq((select current_qty from public.household_products where id = :'cafe'), 0.000::numeric, 'café não fica negativo');
select tests.eq((select count(*) from public.product_price_history where purchase_id = :'p')::int, 0, 'preços saem do histórico enquanto em edição');
select tests.eq((select public.reopen_purchase(:'p')), 0, 'reabrir de novo é idempotente');

-- Correções: quantidade e valor do ketchup, novo item, excluir café
select public.update_purchase_item_values((select id from public.purchase_items where purchase_id = :'p' and description = 'KETCHUP'), 'KETCHUP ZERO', 3, 26.97);
select tests.eq((select stock_quantity from public.purchase_items where purchase_id = :'p' and description = 'KETCHUP ZERO'), 3.000::numeric,
                'quantidade para o estoque acompanha a nova quantidade');
select public.add_purchase_item(:'p', 'SACOLA', 1, 0.10) \gset
select public.delete_purchase_item((select id from public.purchase_items where purchase_id = :'p' and description = 'CAFE'));
select tests.expect_error(format($$ select public.update_purchase_item_values((select id from public.purchase_items where purchase_id = %L limit 1), 'X', 0, 1) $$, :'p'), 'maior que zero');

select public.confirm_purchase(:'p') \gset
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 4.000::numeric, 'confirmar de novo lança a quantidade corrigida (1 + 3)');
select tests.eq((select unit_cost from public.purchase_items where purchase_id = :'p' and description = 'KETCHUP ZERO'), 8.9900::numeric, 'preço recalculado');
select tests.eq((select status::text from public.purchases where id = :'p'), 'confirmed', 'compra confirmada novamente');
select tests.eq(
  (select bool_and(hp.current_qty = coalesce((select sum(m.quantity_delta) from public.stock_movements m where m.household_product_id = hp.id), 0))
     from public.household_products hp where hp.household_id = :'hh'),
  true, 'saldo continua igual à soma das movimentações');

-- ---------------------------------------------------------------------------
-- Remover: estorna e tira do Financeiro
-- ---------------------------------------------------------------------------
select public.remove_purchase(:'p') as rm \gset
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 1.000::numeric, 'remover estorna o estoque (4 − 3)');
select tests.eq((select status::text from public.purchases where id = :'p'), 'discarded', 'compra marcada como removida');
select tests.eq((select count(*) from public.purchase_totals where id = :'p')::int, 0, 'sai do Financeiro');
select tests.eq((select public.remove_purchase(:'p')), 0, 'remover de novo é idempotente');
select tests.expect_error(format($$ select public.reopen_purchase(%L) $$, :'p'), 'removida');
select tests.eq((select count(*) from public.stock_movements where source_id = :'p')::int > 0, true, 'histórico de movimentações preservado');

-- Outra família não mexe
select public.create_purchase_draft(:'hh', 'manual', '{"purchased_at":"2026-11-06T10:00:00-03:00","items":[{"description":"X","quantity":"1","total":"1"}]}'::jsonb) as p2 \gset
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.remove_purchase(%L) $$, :'p2'), 'não encontrada');
select tests.expect_error(format($$ select public.add_purchase_item(%L, 'Y', 1, 1) $$, :'p2'), 'não encontrada');

\echo 'Editar/remover compra: todos os testes passaram.'
