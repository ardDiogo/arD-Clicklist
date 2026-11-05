-- Quem fez a compra (alterável). Por padrão é quem registrou o comprovante.

alter table public.purchases
  add column if not exists bought_by uuid references auth.users (id) on delete set null;

update public.purchases set bought_by = created_by where bought_by is null and created_by is not null;

create or replace function private.purchases_default_buyer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.bought_by := coalesce(new.bought_by, new.created_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists purchases_default_buyer on public.purchases;
create trigger purchases_default_buyer before insert on public.purchases
  for each row execute function private.purchases_default_buyer();

-- Altera o comprador (também em compras confirmadas). null = não informado.
create or replace function public.set_purchase_buyer(p_purchase_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.purchases%rowtype;
begin
  perform private.require_auth();
  select * into v_p from public.purchases where id = p_purchase_id;
  if not found or not private.can_edit(v_p.household_id) or v_p.status = 'discarded' then
    raise exception 'Compra não encontrada' using errcode = 'P0002';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.household_members where household_id = v_p.household_id and user_id = p_user_id
  ) then
    raise exception 'Essa pessoa não faz parte da família' using errcode = '22023';
  end if;

  update public.purchases set bought_by = p_user_id where id = p_purchase_id;
  perform private.audit(v_p.household_id, 'purchase.buyer_changed', 'purchase', p_purchase_id::text,
                        jsonb_build_object('from', v_p.bought_by, 'to', p_user_id));
end;
$$;

revoke execute on function public.set_purchase_buyer(uuid, uuid) from public, anon;
grant execute on function public.set_purchase_buyer(uuid, uuid) to authenticated;
