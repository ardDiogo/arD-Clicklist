-- =============================================================================
-- Produtos parecidos: dois níveis de sugestão + "não são o mesmo"
-- =============================================================================
--   'alta'  → todas as palavras do nome genérico aparecem no outro (regra antiga)
--             ex.: "Pao Forma Seven Boys Leite" → "Pão de forma"
--   'media' → mesma 1ª palavra (4+ letras), ex.: "Cogumelo Odara Int" → "Cogumelo
--             fatiado". Pode não ser o mesmo item ("Leite" × "Leite condensado"),
--             por isso o usuário confirma um a um ou marca "não são o mesmo".
-- Fica o produto cadastrado primeiro (em geral o que o usuário criou).
-- =============================================================================

create table if not exists public.product_merge_dismissals (
  household_id uuid not null references public.households (id) on delete cascade,
  product_a    uuid not null references public.household_products (id) on delete cascade,
  product_b    uuid not null references public.household_products (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (household_id, product_a, product_b),
  check (product_a < product_b)
);

alter table public.product_merge_dismissals enable row level security;
create policy product_merge_dismissals_select on public.product_merge_dismissals
  for select to authenticated using (private.is_member(household_id));

create or replace function public.dismiss_product_merge(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hh uuid;
begin
  perform private.require_auth();
  select household_id into v_hh from public.household_products where id = p_a;
  if v_hh is null or not private.can_edit(v_hh)
     or not exists (select 1 from public.household_products where id = p_b and household_id = v_hh) then
    raise exception 'Produto não encontrado' using errcode = 'P0002';
  end if;
  insert into public.product_merge_dismissals (household_id, product_a, product_b, created_by)
  values (v_hh, least(p_a, p_b), greatest(p_a, p_b), auth.uid())
  on conflict do nothing;
end;
$$;

revoke execute on function public.dismiss_product_merge(uuid, uuid) from public, anon;
grant execute on function public.dismiss_product_merge(uuid, uuid) to authenticated;

drop function if exists public.suggest_product_merges(uuid);
create function public.suggest_product_merges(p_household_id uuid)
returns table (
  from_id uuid, from_name text, from_qty numeric,
  into_id uuid, into_name text, into_qty numeric,
  confidence text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_auth();
  if not private.is_member(p_household_id) then
    raise exception 'Família não encontrada' using errcode = '42501';
  end if;
  return query
  with c as (
    select hp.id, hp.created_at, hp.current_qty, p.name, private.name_tokens(p.name) as tk
      from public.household_products hp
      join public.products p on p.id = hp.product_id
     where hp.household_id = p_household_id and hp.archived_at is null
  ),
  dismissed as (
    select product_a, product_b from public.product_merge_dismissals where household_id = p_household_id
  ),
  -- nível alto: nome genérico contido no específico
  high as (
    select b.id as b_id, b.name as b_name, b.current_qty as b_qty,
           a.id as a_id, a.name as a_name, a.current_qty as a_qty,
           array_length(a.tk, 1) as a_len, a.created_at as a_created
      from c b join c a on a.id <> b.id
     where coalesce(array_length(a.tk, 1), 0) > 0
       and array_length(a.tk, 1) <= array_length(b.tk, 1)
       and (array_length(a.tk, 1) < array_length(b.tk, 1) or a.created_at < b.created_at
            or (a.created_at = b.created_at and a.id < b.id))
       and (a.tk[1] = b.tk[1] or (char_length(b.tk[1]) >= 3 and a.tk[1] like b.tk[1] || '%')
                              or (char_length(a.tk[1]) >= 3 and b.tk[1] like a.tk[1] || '%'))
       and not exists (
         select 1 from unnest(a.tk) t
          where not exists (
            select 1 from unnest(b.tk) d
             where d = t or (char_length(d) >= 3 and t like d || '%') or (char_length(t) >= 3 and d like t || '%')
          )
       )
       and not exists (select 1 from dismissed x where x.product_a = least(a.id, b.id) and x.product_b = greatest(a.id, b.id))
  ),
  high_pick as (
    select distinct on (h.b_id) h.b_id, h.b_name, h.b_qty, h.a_id, h.a_name, h.a_qty, 'alta'::text as conf
      from high h
     where not exists (select 1 from high x where x.b_id = h.a_id)
     order by h.b_id, h.a_len desc, h.a_created
  ),
  -- nível médio: mesma 1ª palavra (4+ letras), fica o mais antigo
  med as (
    select b.id as b_id, b.name as b_name, b.current_qty as b_qty,
           a.id as a_id, a.name as a_name, a.current_qty as a_qty, a.created_at as a_created
      from c b join c a on a.id <> b.id
     where coalesce(array_length(a.tk, 1), 0) > 0 and coalesce(array_length(b.tk, 1), 0) > 0
       and char_length(a.tk[1]) >= 4
       and (a.tk[1] = b.tk[1] or b.tk[1] like a.tk[1] || '%' or a.tk[1] like b.tk[1] || '%')
       and (a.created_at < b.created_at or (a.created_at = b.created_at and a.id < b.id))
       and not exists (select 1 from dismissed x where x.product_a = least(a.id, b.id) and x.product_b = greatest(a.id, b.id))
  ),
  med_pick as (
    select distinct on (m.b_id) m.b_id, m.b_name, m.b_qty, m.a_id, m.a_name, m.a_qty, 'media'::text as conf
      from med m
     where not exists (select 1 from high_pick h where h.b_id = m.b_id or h.b_id = m.a_id)
       and not exists (select 1 from med x where x.b_id = m.a_id) -- junta no mais antigo do grupo
     order by m.b_id, m.a_created
  )
  select b_id, b_name, b_qty, a_id, a_name, a_qty, conf from high_pick
  union all
  select b_id, b_name, b_qty, a_id, a_name, a_qty, conf from med_pick;
end;
$$;

revoke execute on function public.suggest_product_merges(uuid) from public, anon;
grant execute on function public.suggest_product_merges(uuid) to authenticated;
