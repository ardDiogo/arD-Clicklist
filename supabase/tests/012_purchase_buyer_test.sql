-- Testes: comprador da compra (padrão = quem registrou; alterável por membros).
\set ON_ERROR_STOP on
\set QUIET on

\ir _helpers.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'esposa@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household('Casa A') as hh \gset
reset role;
insert into public.household_members (household_id, user_id, role) values (:'hh', '00000000-0000-0000-0000-00000000000b', 'editor');
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a');

select public.create_purchase_draft(:'hh', 'manual', '{"store_name":"Mart Minas","items":[{"description":"ARROZ","quantity":"1","total":"25.90"}]}'::jsonb) as p \gset
select tests.eq((select bought_by::text from public.purchases where id = :'p'), '00000000-0000-0000-0000-00000000000a', 'comprador padrão = quem registrou');

select public.set_purchase_buyer(:'p', '00000000-0000-0000-0000-00000000000b');
select tests.eq((select bought_by::text from public.purchases where id = :'p'), '00000000-0000-0000-0000-00000000000b', 'altera para outro membro');

select tests.expect_error(format($$ select public.set_purchase_buyer(%L, '00000000-0000-0000-0000-00000000000c') $$, :'p'), 'não faz parte');

select public.confirm_purchase(:'p') \gset
select public.set_purchase_buyer(:'p', null);
select tests.eq((select bought_by is null from public.purchases where id = :'p'), true, 'pode limpar, inclusive em compra confirmada');

select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.set_purchase_buyer(%L, '00000000-0000-0000-0000-00000000000c') $$, :'p'), 'não encontrada');

\echo 'Comprador da compra: todos os testes passaram.'
