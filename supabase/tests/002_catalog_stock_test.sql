-- Testes da Fase 2: catálogo, ambientes, estoque e movimentações.
\set ON_ERROR_STOP on
\set QUIET on

create schema tests;
grant usage on schema tests to authenticated, anon;

create function tests.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
end $$;

create function tests.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALHOU: esperava erro "%" em: %', p_like, p_sql;
exception
  when others then
    if sqlerrm like 'FALHOU:%' then raise; end if;
    if sqlerrm not ilike '%' || p_like || '%' then
      raise exception 'FALHOU: erro diferente. Esperado "%", recebido "%"', p_like, sqlerrm;
    end if;
end $$;

create function tests.eq(p_actual anyelement, p_expected anyelement, p_msg text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALHOU: % (esperado %, obtido %)', p_msg, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com',  '{"full_name":"Diogo"}'),
  ('00000000-0000-0000-0000-00000000000b', 'leitor@example.com', '{"full_name":"Leitor"}'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com',  '{"full_name":"Outra"}');

set role authenticated;

-- ---------------------------------------------------------------------------
-- Setup: duas famílias, um leitor na família A
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh_a \gset
select public.create_household_invite(:'hh_a', 'viewer') as tok \gset
select tests.login('00000000-0000-0000-0000-00000000000b');
select public.accept_household_invite(:'tok') \gset
select tests.login('00000000-0000-0000-0000-00000000000c');
select public.create_household('Casa C') as hh_c \gset
select id as loc_c from public.locations where household_id = :'hh_c' and name = 'Despensa' \gset

-- ---------------------------------------------------------------------------
-- Categorias e ambientes padrão
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.eq((select count(*) from public.categories where household_id is null)::int, 9,
                'nove categorias padrão globais');
select tests.eq((select count(*) from public.locations where household_id = :'hh_a')::int, 8,
                'família nova recebe 8 ambientes padrão');
select tests.eq((select count(*) from public.locations where household_id = :'hh_c')::int, 0,
                'A não enxerga ambientes de C');
select id as loc_desp from public.locations where household_id = :'hh_a' and name = 'Despensa' \gset
select id as loc_gel from public.locations where household_id = :'hh_a' and name = 'Geladeira' \gset
select id as cat_merc from public.categories where household_id is null and name = 'Mercearia' \gset

-- ---------------------------------------------------------------------------
-- Cadastro de produto com estoque inicial
-- ---------------------------------------------------------------------------
select public.create_tracked_product(
  :'hh_a', 'Ketchup Zero', 'Bonare', :'cat_merc', 'Zero açúcar', 380, 'g', '7896000000017',
  :'loc_desp', 3, 1) as ketchup \gset

select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 1.000::numeric,
                'estoque inicial registrado');
select tests.eq((select to_buy_qty from public.household_stock where id = :'ketchup'), 2.000::numeric,
                'comprar = ideal 3 - atual 1 = 2');
select tests.eq((select status from public.household_stock where id = :'ketchup'), 'low', 'status baixo');
select tests.eq((select count(*) from public.stock_movements where household_product_id = :'ketchup')::int, 1,
                'estoque inicial gerou movimentação');
select tests.eq((select brand_name from public.household_stock where id = :'ketchup'), 'Bonare', 'marca criada');

-- Marca não duplica por maiúsculas
select public.create_tracked_product(:'hh_a', 'Ketchup Tradicional', 'BONARE', :'cat_merc') \gset
select tests.eq((select count(*) from public.brands where household_id = :'hh_a')::int, 1,
                'marca reaproveitada sem diferenciar maiúsculas');

-- Produto sem estoque e ideal 0 não precisa ser comprado
select public.create_tracked_product(:'hh_a', 'Arroz', 'Tio João', :'cat_merc', null, 5, 'kg', null, :'loc_desp', 1, 1)
  as arroz \gset
select tests.eq((select to_buy_qty from public.household_stock where id = :'arroz'), 0.000::numeric,
                'arroz com ideal 1 e atual 1 não entra na compra');
select tests.eq((select status from public.household_stock where id = :'arroz'), 'ok', 'status ok');

-- Validações
select tests.expect_error(
  format($$ select public.create_tracked_product(%L, 'X', null, null, null, null, 'un', null, %L, 1, 0) $$, :'hh_a', :'loc_c'),
  'pertence a outra família');
select tests.expect_error(
  format($$ select public.create_tracked_product(%L, 'X', null, null, null, null, 'un', null, null, -1, 0) $$, :'hh_a'),
  'negativas');
select tests.expect_error(
  format($$ select public.create_tracked_product(%L, 'X', null, null, null, null, 'un', 'abc123') $$, :'hh_a'),
  'products_barcode_check');
select tests.expect_error(
  format($$ select public.create_tracked_product(%L, 'Ketchup cópia', null, null, null, null, 'un', '7896000000017') $$, :'hh_a'),
  'products_unique_barcode');

-- ---------------------------------------------------------------------------
-- Movimentações
-- ---------------------------------------------------------------------------
select public.record_stock_movement(:'ketchup', 'purchase', 2, 'Compra avulsa', 'idem-key-0001') as mv1 \gset
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 3.000::numeric,
                'compra soma ao estoque');
select tests.eq((select public.record_stock_movement(:'ketchup', 'purchase', 2, 'Compra avulsa', 'idem-key-0001'))::text,
                :'mv1'::text, 'mesma chave de idempotência devolve a mesma movimentação');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 3.000::numeric,
                'repetição idempotente não altera estoque');

select public.record_stock_movement(:'ketchup', 'consumption', 0.5) \gset
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 2.500::numeric,
                'consumo fracionado');
select tests.expect_error(format($$ select public.record_stock_movement(%L, 'consumption', 5) $$, :'ketchup'),
                          'Estoque insuficiente');
select tests.expect_error(format($$ select public.record_stock_movement(%L, 'consumption', 0) $$, :'ketchup'),
                          'maior que zero');
select tests.expect_error(format($$ select public.record_stock_movement(%L, 'correction', -10) $$, :'ketchup'),
                          'Estoque insuficiente');

select public.record_stock_movement(:'ketchup', 'inventory_adjustment', 0, 'Acabou') \gset
select tests.eq((select status from public.household_stock where id = :'ketchup'), 'out', 'contagem zero = sem estoque');
select tests.eq((select quantity_delta from public.stock_movements
                  where household_product_id = :'ketchup' order by created_at desc, id limit 1), -2.500::numeric,
                'ajuste registra a diferença');

select public.record_stock_movement(:'ketchup', 'correction', 1) \gset

-- Transferência
select public.transfer_household_product(:'ketchup', :'loc_gel') \gset
select tests.eq((select location_name from public.household_stock where id = :'ketchup'), 'Geladeira',
                'transferência muda o ambiente');
select tests.eq((select current_qty from public.household_products where id = :'ketchup'), 1.000::numeric,
                'transferência não altera quantidade');
select tests.expect_error(format($$ select public.transfer_household_product(%L, %L) $$, :'ketchup', :'loc_gel'),
                          'já está neste ambiente');
select tests.expect_error(format($$ select public.transfer_household_product(%L, %L) $$, :'ketchup', :'loc_c'),
                          'pertence a outra família');

-- Saldo sempre igual à soma do histórico
select tests.eq(
  (select bool_and(hp.current_qty = coalesce((select sum(m.quantity_delta) from public.stock_movements m
                                              where m.household_product_id = hp.id), 0))
     from public.household_products hp where hp.household_id = :'hh_a'),
  true, 'saldo = soma das movimentações para todos os itens');

-- ---------------------------------------------------------------------------
-- Proteções de escrita direta
-- ---------------------------------------------------------------------------
select tests.expect_error(format($$ update public.household_products set current_qty = 99 where id = %L $$, :'ketchup'),
                          'permission denied');
select tests.expect_error(format($$ update public.household_products set location_id = null where id = %L $$, :'ketchup'),
                          'permission denied');
select tests.expect_error(format($$ delete from public.household_products where id = %L $$, :'ketchup'),
                          'permission denied');
select tests.expect_error($$ delete from public.stock_movements $$, 'permission denied');
select tests.expect_error(
  format($$ insert into public.stock_movements (household_id, household_product_id, type, quantity_delta, quantity_before, quantity_after)
            values (%L, %L, 'purchase', 100, 0, 100) $$, :'hh_a', :'ketchup'),
  'permission denied');

-- Ideal e notas podem ser editados diretamente por editores
update public.household_products set ideal_qty = 6 where id = :'ketchup';
select tests.eq((select to_buy_qty from public.household_stock where id = :'ketchup'), 5.000::numeric,
                'alterar ideal recalcula compra');

-- Atualização completa via RPC
select public.update_tracked_product(:'ketchup', 'Ketchup Zero', 'Heinz', :'cat_merc', null, 397, 'g', null, 4, 'Preferir sachê');
select tests.eq((select brand_name || '|' || trim_scale(package_size)::text || '|' || trim_scale(ideal_qty)::text
                   from public.household_stock where id = :'ketchup'),
                'Heinz|397|4', 'edição de produto e ideal');

-- ---------------------------------------------------------------------------
-- Leitor (viewer) só lê
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.eq((select count(*) from public.household_stock where household_id = :'hh_a')::int, 3,
                'leitor vê o estoque da família');
select tests.expect_error(format($$ select public.record_stock_movement(%L, 'consumption', 1) $$, :'ketchup'),
                          'não encontrado');
select tests.expect_error(format($$ select public.create_tracked_product(%L, 'Y') $$, :'hh_a'), 'permissão');
update public.household_products set ideal_qty = 50 where id = :'ketchup';
select tests.eq((select ideal_qty from public.household_products where id = :'ketchup'), 4.000::numeric,
                'update do leitor não afeta nenhuma linha (RLS)');

-- ---------------------------------------------------------------------------
-- Isolamento entre famílias
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.eq((select count(*) from public.household_stock)::int, 0, 'C não vê estoque de A');
select tests.eq((select count(*) from public.products where household_id = :'hh_a')::int, 0, 'C não vê produtos de A');
select tests.eq((select count(*) from public.stock_movements)::int, 0, 'C não vê movimentações de A');
select tests.eq((select count(*) from public.brands where household_id = :'hh_a')::int, 0, 'C não vê marcas de A');
select tests.expect_error(format($$ select public.record_stock_movement(%L, 'purchase', 1) $$, :'ketchup'),
                          'não encontrado');
select tests.expect_error(
  format($$ insert into public.locations (household_id, name) values (%L, 'Invasão') $$, :'hh_a'),
  'row-level security');
-- Produto de C não pode usar marca de A
reset role;
select id as brand_a from public.brands where name = 'Heinz' \gset
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(
  format($$ insert into public.products (household_id, name, brand_id) values (%L, 'Z', %L) $$, :'hh_c', :'brand_a'),
  'pertence a outra família');

-- ---------------------------------------------------------------------------
-- Ambientes e arquivamento
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');
insert into public.locations (household_id, name) values (:'hh_a', 'Adega');
select tests.expect_error(format($$ insert into public.locations (household_id, name) values (%L, 'adega') $$, :'hh_a'),
                          'locations_unique_name');
select public.archive_location(:'loc_gel');
select tests.eq((select location_id from public.household_stock where id = :'ketchup')::text, null::text,
                'arquivar ambiente deixa itens sem ambiente');

select public.archive_household_product(:'arroz');
select tests.eq((select count(*) from public.household_stock where id = :'arroz')::int, 0,
                'item arquivado some do estoque');
select tests.eq((select count(*) from public.stock_movements where household_product_id = :'arroz')::int, 1,
                'histórico do item arquivado é preservado');

-- Histórico imutável mesmo para o dono das tabelas
reset role;
select tests.expect_error($$ update public.stock_movements set quantity_delta = 0 $$, 'imutáveis');
select tests.expect_error($$ delete from public.stock_movements $$, 'imutáveis');

-- Mas apagar a família remove tudo em cascata
delete from public.households where id = :'hh_c';
delete from public.households where id = :'hh_a';
select tests.eq((select count(*) from public.stock_movements)::int, 0, 'exclusão em cascata da família funciona');

\echo 'Fase 2: todos os testes passaram.'
