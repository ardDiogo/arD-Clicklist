-- =============================================================================
-- FASE 1 — Fundação: perfis, famílias (households), membros, convites, auditoria
-- =============================================================================
-- Princípios:
--   * Toda tabela com dados privados tem RLS habilitado.
--   * Escritas sensíveis (criar família, convites, papéis) passam por funções
--     SECURITY DEFINER que validam auth.uid() e o papel na família.
--   * Funções auxiliares ficam no schema "private", que NÃO é exposto pela API.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
-- admin  : gerencia família, membros e convites; edita tudo
-- editor : edita listas, estoque, produtos e compras
-- viewer : somente leitura
create type public.household_role as enum ('admin', 'editor', 'viewer');

-- -----------------------------------------------------------------------------
-- Utilitários genéricos
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Impede que um registro seja "movido" para outra família via UPDATE.
-- Será reutilizado por todas as tabelas com household_id nas próximas fases.
create or replace function private.prevent_household_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id then
    raise exception 'household_id é imutável' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfis
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (full_name is null or char_length(full_name) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Cria o perfil automaticamente no cadastro.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Famílias
-- -----------------------------------------------------------------------------
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 80),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create trigger households_updated_at
  before update on public.households
  for each row execute function private.set_updated_at();

create table public.household_members (
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.household_role not null default 'editor',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members (user_id);

create trigger household_members_updated_at
  before update on public.household_members
  for each row execute function private.set_updated_at();

create trigger household_members_immutable_household
  before update on public.household_members
  for each row execute function private.prevent_household_change();

create table public.household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  -- Token aleatório de 32 bytes; só administradores da família conseguem lê-lo.
  token         text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  -- Opcional: se preenchido, somente esse e-mail pode aceitar o convite.
  email         text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role          public.household_role not null default 'editor',
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_by   uuid references auth.users (id) on delete set null,
  accepted_at   timestamptz,
  revoked_at    timestamptz
);

create index household_invites_household_idx on public.household_invites (household_id);

create trigger household_invites_immutable_household
  before update on public.household_invites
  for each row execute function private.prevent_household_change();

-- -----------------------------------------------------------------------------
-- Auditoria (somente inserida por funções; nunca editada)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id            bigint generated always as identity primary key,
  household_id  uuid references public.households (id) on delete cascade,
  actor_id      uuid references auth.users (id) on delete set null,
  action        text not null,
  entity        text not null,
  entity_id     text,
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index audit_log_household_idx on public.audit_log (household_id, created_at desc);

create or replace function private.audit(
  p_household_id uuid,
  p_action text,
  p_entity text,
  p_entity_id text,
  p_data jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (household_id, actor_id, action, entity, entity_id, data)
  values (p_household_id, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_data, '{}'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- Funções de pertencimento (usadas pelas políticas RLS)
-- SECURITY DEFINER evita recursão de RLS em household_members.
-- -----------------------------------------------------------------------------
create or replace function private.is_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    join public.households h on h.id = m.household_id
    where m.household_id = p_household_id
      and m.user_id = auth.uid()
      and h.deleted_at is null
  );
$$;

create or replace function private.has_role(p_household_id uuid, p_roles public.household_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    join public.households h on h.id = m.household_id
    where m.household_id = p_household_id
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
      and h.deleted_at is null
  );
$$;

create or replace function private.can_edit(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_household_id, array['admin', 'editor']::public.household_role[]);
$$;

create or replace function private.is_admin(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_household_id, array['admin']::public.household_role[]);
$$;

create or replace function private.require_auth()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.audit_log         enable row level security;

-- Perfis: o próprio usuário e quem divide uma família com ele.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.household_members mine
      join public.household_members theirs on theirs.household_id = mine.household_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Famílias: leitura para membros; renomear somente via RPC.
create policy households_select on public.households
  for select to authenticated
  using (deleted_at is null and private.is_member(id));

-- Membros: leitura para quem é da mesma família. Escrita apenas via RPC.
create policy household_members_select on public.household_members
  for select to authenticated
  using (private.is_member(household_id));

-- Convites: somente administradores enxergam (inclusive o token).
create policy household_invites_select on public.household_invites
  for select to authenticated
  using (private.is_admin(household_id));

-- Auditoria: membros podem consultar o histórico da própria família.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (private.is_member(household_id));

-- Privilégios de tabela: leitura passa pelo RLS; escrita só onde há política.
revoke all on public.profiles, public.households, public.household_members,
              public.household_invites, public.audit_log from anon, authenticated;
grant select on public.profiles, public.households, public.household_members,
                public.household_invites, public.audit_log to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- RPCs (API pública)
-- -----------------------------------------------------------------------------

-- Cria uma família e torna o usuário atual administrador.
create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_auth();
  v_id  uuid;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'Nome da família inválido' using errcode = '22023';
  end if;

  insert into public.households (name, created_by)
  values (trim(p_name), v_uid)
  returning id into v_id;

  insert into public.household_members (household_id, user_id, role)
  values (v_id, v_uid, 'admin');

  perform private.audit(v_id, 'household.created', 'household', v_id::text,
                        jsonb_build_object('name', trim(p_name)));
  return v_id;
end;
$$;

create or replace function public.rename_household(p_household_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_auth();
  if not private.is_admin(p_household_id) then
    raise exception 'Somente administradores podem renomear a família' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'Nome da família inválido' using errcode = '22023';
  end if;

  update public.households set name = trim(p_name) where id = p_household_id;
  perform private.audit(p_household_id, 'household.renamed', 'household', p_household_id::text,
                        jsonb_build_object('name', trim(p_name)));
end;
$$;

-- Gera um convite. Retorna o token, que vira o link de convite.
create or replace function public.create_household_invite(
  p_household_id uuid,
  p_role public.household_role default 'editor',
  p_email text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_auth();
  v_token text;
  v_id    uuid;
begin
  if not private.is_admin(p_household_id) then
    raise exception 'Somente administradores podem convidar' using errcode = '42501';
  end if;

  insert into public.household_invites (household_id, role, email, created_by)
  values (p_household_id, coalesce(p_role, 'editor'), nullif(lower(trim(p_email)), ''), v_uid)
  returning id, token into v_id, v_token;

  perform private.audit(p_household_id, 'invite.created', 'household_invite', v_id::text,
                        jsonb_build_object('role', p_role, 'email', nullif(lower(trim(p_email)), '')));
  return v_token;
end;
$$;

create or replace function public.revoke_household_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  perform private.require_auth();
  select household_id into v_household from public.household_invites where id = p_invite_id;
  if v_household is null or not private.is_admin(v_household) then
    raise exception 'Convite não encontrado' using errcode = 'P0002';
  end if;

  update public.household_invites
     set revoked_at = now()
   where id = p_invite_id and accepted_at is null and revoked_at is null;

  perform private.audit(v_household, 'invite.revoked', 'household_invite', p_invite_id::text);
end;
$$;

-- Pré-visualização do convite (para a tela "Você foi convidado para...").
-- Retorna apenas o necessário; não expõe outros dados da família.
create or replace function public.get_invite_preview(p_token text)
returns table (household_name text, role public.household_role, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_auth();
  return query
  select h.name,
         i.role,
         case
           when i.revoked_at is not null then 'revoked'
           when i.accepted_at is not null then 'accepted'
           when i.expires_at < now() then 'expired'
           else 'valid'
         end
  from public.household_invites i
  join public.households h on h.id = i.household_id and h.deleted_at is null
  where i.token = p_token;
end;
$$;

-- Aceita o convite. Idempotente: aceitar duas vezes não duplica o membro.
create or replace function public.accept_household_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_auth();
  v_email  text;
  v_invite public.household_invites%rowtype;
begin
  select * into v_invite
    from public.household_invites
   where token = p_token
   for update;

  if not found then
    raise exception 'Convite inválido' using errcode = 'P0002';
  end if;

  -- Já é membro? Retorna a família sem erro (idempotência).
  if exists (select 1 from public.household_members
              where household_id = v_invite.household_id and user_id = v_uid) then
    return v_invite.household_id;
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'Este convite foi cancelado' using errcode = '22023';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'Este convite já foi utilizado' using errcode = '22023';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'Este convite expirou' using errcode = '22023';
  end if;

  if v_invite.email is not null then
    select lower(email) into v_email from auth.users where id = v_uid;
    if v_email is distinct from v_invite.email then
      raise exception 'Este convite foi enviado para outro e-mail' using errcode = '42501';
    end if;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, v_uid, v_invite.role);

  update public.household_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = v_invite.id;

  perform private.audit(v_invite.household_id, 'member.joined', 'household_member', v_uid::text,
                        jsonb_build_object('role', v_invite.role, 'invite_id', v_invite.id));
  return v_invite.household_id;
end;
$$;

-- Altera o papel de um membro. Garante que sempre reste ao menos um admin.
create or replace function public.update_member_role(
  p_household_id uuid,
  p_user_id uuid,
  p_role public.household_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.household_role;
begin
  perform private.require_auth();
  if not private.is_admin(p_household_id) then
    raise exception 'Somente administradores podem alterar papéis' using errcode = '42501';
  end if;

  -- Trava as linhas de membros da família para evitar corrida entre dois admins.
  perform 1 from public.household_members where household_id = p_household_id for update;

  select role into v_current
    from public.household_members
   where household_id = p_household_id and user_id = p_user_id;

  if v_current is null then
    raise exception 'Membro não encontrado' using errcode = 'P0002';
  end if;

  if v_current = 'admin' and p_role <> 'admin' and (
    select count(*) from public.household_members
     where household_id = p_household_id and role = 'admin'
  ) <= 1 then
    raise exception 'A família precisa de pelo menos um administrador' using errcode = '22023';
  end if;

  update public.household_members
     set role = p_role
   where household_id = p_household_id and user_id = p_user_id;

  perform private.audit(p_household_id, 'member.role_changed', 'household_member', p_user_id::text,
                        jsonb_build_object('from', v_current, 'to', p_role));
end;
$$;

-- Remove um membro (admin) ou sai da família (o próprio usuário).
create or replace function public.remove_household_member(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_auth();
  v_role public.household_role;
begin
  if p_user_id <> v_uid and not private.is_admin(p_household_id) then
    raise exception 'Somente administradores podem remover membros' using errcode = '42501';
  end if;

  perform 1 from public.household_members where household_id = p_household_id for update;

  select role into v_role
    from public.household_members
   where household_id = p_household_id and user_id = p_user_id;

  if v_role is null then
    raise exception 'Membro não encontrado' using errcode = 'P0002';
  end if;

  if v_role = 'admin' and (
    select count(*) from public.household_members
     where household_id = p_household_id and role = 'admin'
  ) <= 1 then
    raise exception 'A família precisa de pelo menos um administrador' using errcode = '22023';
  end if;

  delete from public.household_members
   where household_id = p_household_id and user_id = p_user_id;

  perform private.audit(p_household_id,
                        case when p_user_id = v_uid then 'member.left' else 'member.removed' end,
                        'household_member', p_user_id::text);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões de execução
-- -----------------------------------------------------------------------------
-- Só as funções usadas dentro das políticas RLS precisam ser executáveis
-- pelo papel "authenticated". As demais rodam dentro de funções SECURITY DEFINER.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_member(uuid),
  private.has_role(uuid, public.household_role[]),
  private.can_edit(uuid),
  private.is_admin(uuid)
to authenticated;

revoke execute on function
  public.create_household(text),
  public.rename_household(uuid, text),
  public.create_household_invite(uuid, public.household_role, text),
  public.revoke_household_invite(uuid),
  public.get_invite_preview(text),
  public.accept_household_invite(text),
  public.update_member_role(uuid, uuid, public.household_role),
  public.remove_household_member(uuid, uuid)
from public, anon;

grant execute on function
  public.create_household(text),
  public.rename_household(uuid, text),
  public.create_household_invite(uuid, public.household_role, text),
  public.revoke_household_invite(uuid),
  public.get_invite_preview(text),
  public.accept_household_invite(text),
  public.update_member_role(uuid, uuid, public.household_role),
  public.remove_household_member(uuid, uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: membros da família recebem alterações (RLS também se aplica).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.household_members;
  end if;
end;
$$;
