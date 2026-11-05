-- Testes da Fase 1: famílias, membros, convites e isolamento por RLS.
-- Executar com: npm run test:db
\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------------------
-- Helpers de teste
-- ---------------------------------------------------------------------------
\ir _helpers.sql

-- Usuários
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'diogo@example.com',  '{"full_name":"Diogo"}'),
  ('00000000-0000-0000-0000-00000000000b', 'esposa@example.com', '{"full_name":"Esposa"}'),
  ('00000000-0000-0000-0000-00000000000c', 'outra@example.com',  '{"full_name":"Outra família"}'),
  ('00000000-0000-0000-0000-00000000000d', 'convidado@example.com', '{}');

select tests.eq((select count(*) from public.profiles)::int, 4, 'perfil criado automaticamente no cadastro');
select tests.eq((select full_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
                'Diogo', 'nome do perfil vem do metadata');

-- ---------------------------------------------------------------------------
-- Anônimo não executa nada
-- ---------------------------------------------------------------------------
set role anon;
select tests.expect_error($$ select public.create_household('X') $$, 'permission denied');
select tests.expect_error($$ select * from public.households $$, 'permission denied');
reset role;

-- ---------------------------------------------------------------------------
-- Criação de família
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.login(null);
select tests.expect_error($$ select public.create_household('Sem login') $$, 'Não autenticado');

select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.expect_error($$ select public.create_household('   ') $$, 'Nome da família inválido');

select public.create_household('Casa do Diogo') as hh_a \gset
select tests.eq((select role::text from public.household_members
                  where household_id = :'hh_a' and user_id = auth.uid()),
                'admin', 'criador vira administrador');

-- Escrita direta nas tabelas é bloqueada (somente via RPC)
select tests.expect_error(
  format($$ insert into public.household_members (household_id, user_id, role)
            values (%L, '00000000-0000-0000-0000-00000000000c', 'admin') $$, :'hh_a'),
  'permission denied');
select tests.expect_error(
  format($$ update public.households set name = 'hack' where id = %L $$, :'hh_a'),
  'permission denied');

-- Outra família
select tests.login('00000000-0000-0000-0000-00000000000c');
select public.create_household('Casa da Outra') as hh_c \gset

-- ---------------------------------------------------------------------------
-- Isolamento entre famílias
-- ---------------------------------------------------------------------------
select tests.eq((select count(*) from public.households)::int, 1, 'usuária C vê só a própria família');
select tests.eq((select count(*) from public.households where id = :'hh_a')::int, 0,
                'C não enxerga a família de A');
select tests.eq((select count(*) from public.household_members where household_id = :'hh_a')::int, 0,
                'C não enxerga membros de A');
select tests.eq((select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000a')::int, 0,
                'C não enxerga o perfil de A');
select tests.eq((select count(*) from public.audit_log where household_id = :'hh_a')::int, 0,
                'C não enxerga a auditoria de A');
select tests.expect_error(format($$ select public.create_household_invite(%L) $$, :'hh_a'),
                          'Somente administradores');
select tests.expect_error(format($$ select public.rename_household(%L, 'hack') $$, :'hh_a'),
                          'Somente administradores');

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household_invite(:'hh_a', 'admin') as token_b \gset
select tests.eq(length(:'token_b'), 64, 'token de convite com 32 bytes aleatórios');

select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.eq((select count(*) from public.household_invites)::int, 0,
                'não-membro não lê tabela de convites');
select tests.eq((select status from public.get_invite_preview(:'token_b')), 'valid', 'preview do convite');
select tests.eq((select household_name from public.get_invite_preview(:'token_b')), 'Casa do Diogo',
                'preview mostra nome da família');

select public.accept_household_invite(:'token_b') as joined \gset
select tests.eq(:'joined'::text, :'hh_a'::text, 'aceitar retorna a família');
select tests.eq((select public.accept_household_invite(:'token_b'))::text, :'hh_a',
                'aceitar de novo é idempotente');
select tests.eq((select count(*) from public.household_members where household_id = :'hh_a')::int, 2,
                'sem membro duplicado');
select tests.eq((select count(*) from public.profiles)::int, 2, 'B passa a ver o perfil de A');

-- Convite já usado não serve para terceiros
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.accept_household_invite(%L) $$, :'token_b'),
                          'já foi utilizado');
select tests.expect_error($$ select public.accept_household_invite('nao-existe') $$, 'Convite inválido');

-- Convite restrito por e-mail
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household_invite(:'hh_a', 'viewer', 'Convidado@Example.com') as token_d \gset
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.accept_household_invite(%L) $$, :'token_d'),
                          'outro e-mail');
select tests.login('00000000-0000-0000-0000-00000000000d');
select public.accept_household_invite(:'token_d') \gset
select tests.eq((select role::text from public.household_members
                  where household_id = :'hh_a' and user_id = auth.uid()),
                'viewer', 'convidado por e-mail entra com o papel do convite');

-- Convite revogado e expirado
select tests.login('00000000-0000-0000-0000-00000000000a');
select public.create_household_invite(:'hh_a') as token_r \gset
select public.revoke_household_invite((select id from public.household_invites where token = :'token_r'));
reset role;
insert into public.household_invites (household_id, expires_at) values (:'hh_a', now() - interval '1 minute')
returning token as token_x \gset
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error(format($$ select public.accept_household_invite(%L) $$, :'token_r'), 'cancelado');
select tests.expect_error(format($$ select public.accept_household_invite(%L) $$, :'token_x'), 'expirou');

-- ---------------------------------------------------------------------------
-- Papéis
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000d');  -- viewer
select tests.expect_error(
  format($$ select public.update_member_role(%L, '00000000-0000-0000-0000-00000000000d', 'admin') $$, :'hh_a'),
  'Somente administradores');
select tests.expect_error(
  format($$ select public.remove_household_member(%L, '00000000-0000-0000-0000-00000000000b') $$, :'hh_a'),
  'Somente administradores');

select tests.login('00000000-0000-0000-0000-00000000000a');
select public.update_member_role(:'hh_a', '00000000-0000-0000-0000-00000000000b', 'editor');
select tests.expect_error(
  format($$ select public.update_member_role(%L, '00000000-0000-0000-0000-00000000000a', 'editor') $$, :'hh_a'),
  'pelo menos um administrador');
select tests.expect_error(
  format($$ select public.remove_household_member(%L, '00000000-0000-0000-0000-00000000000a') $$, :'hh_a'),
  'pelo menos um administrador');

-- Membro pode sair sozinho
select tests.login('00000000-0000-0000-0000-00000000000d');
select public.remove_household_member(:'hh_a', '00000000-0000-0000-0000-00000000000d');
select tests.eq((select count(*) from public.households)::int, 0, 'quem saiu perde acesso à família');

-- household_id é imutável mesmo para superusuário
reset role;
select tests.expect_error(
  format($$ update public.household_members set household_id = %L where household_id = %L $$, :'hh_c', :'hh_a'),
  'household_id é imutável');

-- Auditoria registrada
select tests.eq((select count(*) from public.audit_log where household_id = :'hh_a' and action = 'member.joined')::int,
                2, 'entradas de membros auditadas');

\echo 'Fase 1: todos os testes passaram.'
