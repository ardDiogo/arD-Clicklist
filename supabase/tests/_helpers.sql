-- Helpers compartilhados pelos testes SQL (incluídos com \ir).
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
