-- =============================================================================
-- Mesmo mercado = mesmo CNPJ, mesmo que a compra tenha vindo sem CNPJ
-- =============================================================================
-- Compras cadastradas sem CNPJ (manuais/antigas) eram tratadas como outro
-- estabelecimento que uma compra com CNPJ e o mesmo nome. Agora:
--   * compra sem CNPJ herda o CNPJ de outra compra da família com o mesmo nome;
--   * quando chega uma compra com CNPJ, as do mesmo nome sem CNPJ o recebem;
--   * vale também ao renomear o estabelecimento (lápis na compra).
-- Nomes comparados sem acentos/maiúsculas/pontuação.
-- =============================================================================

create or replace function private.purchases_fill_cnpj()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.store_cnpj is null and new.store_name is not null then
    select p.store_cnpj into new.store_cnpj
      from public.purchases p
     where p.household_id = new.household_id and p.id <> new.id and p.store_cnpj is not null
       and private.normalize_text(p.store_name) = private.normalize_text(new.store_name)
     order by p.created_at desc
     limit 1;
  end if;
  return new;
end;
$$;

create or replace function private.purchases_share_cnpj()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.store_cnpj is not null and new.store_name is not null then
    update public.purchases p
       set store_cnpj = new.store_cnpj
     where p.household_id = new.household_id and p.id <> new.id and p.store_cnpj is null
       and private.normalize_text(p.store_name) = private.normalize_text(new.store_name);
  end if;
  return null;
end;
$$;

drop trigger if exists purchases_fill_cnpj on public.purchases;
create trigger purchases_fill_cnpj before insert or update of store_name, store_cnpj on public.purchases
  for each row execute function private.purchases_fill_cnpj();

drop trigger if exists purchases_share_cnpj on public.purchases;
create trigger purchases_share_cnpj after insert or update of store_name, store_cnpj on public.purchases
  for each row execute function private.purchases_share_cnpj();

-- Corrige o que já existe.
update public.purchases p
   set store_cnpj = x.store_cnpj
  from (
    select distinct on (household_id, private.normalize_text(store_name))
           household_id, private.normalize_text(store_name) as nkey, store_cnpj
      from public.purchases
     where store_cnpj is not null and store_name is not null
     order by household_id, private.normalize_text(store_name), created_at desc
  ) x
 where p.store_cnpj is null and p.household_id = x.household_id
   and private.normalize_text(p.store_name) = x.nkey;
