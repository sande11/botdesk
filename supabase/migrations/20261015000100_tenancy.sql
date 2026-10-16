-- ============================================================
-- BotDesk v2 — tenancy: workspaces, members, roles, invites, plans
-- ============================================================
-- Every row of tenant data carries a workspace_id. Row Level Security
-- lets a signed-in user see a row only if they are a member of its
-- workspace with a high enough role:
--
--   owner > admin > editor > reviewer > viewer
--
--   owner     billing, delete workspace, everything below
--   admin     members, API keys, model keys, channels
--   editor    bots, knowledge, training, evals
--   reviewer  inbox replies, review queue (e.g. lawyers checking answers)
--   viewer    read-only
--
-- Edge Functions use the service role and check access in code.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

-- ── Helpers ────────────────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.role_rank(r text)
returns int language sql immutable as $$
  select case r
    when 'owner' then 50
    when 'admin' then 40
    when 'editor' then 30
    when 'reviewer' then 20
    when 'viewer' then 10
    else 0
  end
$$;

create or replace function public.random_token(n_bytes int default 24)
returns text language sql volatile as $$
  select translate(encode(extensions.gen_random_bytes(n_bytes), 'base64'), '+/=', '-_')
$$;

create or replace function public.sha256_hex(input text)
returns text language sql immutable as $$
  select encode(extensions.digest(convert_to(input, 'UTF8'), 'sha256'), 'hex')
$$;

-- ── Plans ──────────────────────────────────────────────────────────────────

create table if not exists public.plans (
  id          text primary key,
  name        text not null,
  price_cents int  not null default 0,
  -- messages_per_month, bots, sources, storage_mb, members, platform_ai (bool)
  limits      jsonb not null default '{}',
  sort        int  not null default 0
);

insert into public.plans (id, name, price_cents, limits, sort) values
  ('free',       'Free',       0,
   '{"messages_per_month": 300,    "bots": 1,  "sources": 25,    "storage_mb": 100,   "members": 2,   "platform_ai": true}', 0),
  ('pro',        'Pro',        4900,
   '{"messages_per_month": 5000,   "bots": 5,  "sources": 500,   "storage_mb": 2000,  "members": 10,  "platform_ai": true}', 1),
  ('business',   'Business',   19900,
   '{"messages_per_month": 50000,  "bots": 25, "sources": 5000,  "storage_mb": 20000, "members": 50,  "platform_ai": true}', 2),
  ('enterprise', 'Enterprise', 0,
   '{"messages_per_month": null,   "bots": null, "sources": null, "storage_mb": null, "members": null, "platform_ai": false}', 3)
on conflict (id) do nothing;

-- ── Profiles ───────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  full_name         text,
  avatar_url        text,
  is_platform_admin bool not null default false,
  created_at        timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing users (from v1) get a profile too.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

create or replace function public.is_platform_admin()
returns bool language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from profiles where id = auth.uid()), false)
$$;

-- ── Workspaces ─────────────────────────────────────────────────────────────

create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 80),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  plan       text not null default 'free' references public.plans(id),
  -- Feature packs, e.g. {"legal": true}
  features   jsonb not null default '{}',
  -- retention_days, jurisdictions[], default_jurisdiction, review_sample_rate,
  -- notify_email, allow_platform_ai
  settings   jsonb not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists workspaces_updated_at on public.workspaces;
create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function public.touch_updated_at();

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner','admin','editor','reviewer','viewer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user on public.workspace_members(user_id);

create table if not exists public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('admin','editor','reviewer','viewer')),
  token_hash   text not null unique,
  invited_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists workspace_invites_open
  on public.workspace_invites(workspace_id, lower(email)) where accepted_at is null;

-- ── Membership checks used by every policy ─────────────────────────────────

-- Workspaces where the current user has at least `min_role`.
-- Use as: workspace_id in (select public.my_workspaces('editor'))
create or replace function public.my_workspaces(min_role text default 'viewer')
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.workspace_id
  from workspace_members m
  where m.user_id = auth.uid()
    and role_rank(m.role) >= role_rank(min_role)
$$;

create or replace function public.has_role(ws uuid, min_role text default 'viewer')
returns bool language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws
      and m.user_id = auth.uid()
      and role_rank(m.role) >= role_rank(min_role)
  )
$$;

create or replace function public.shares_workspace(other uuid)
returns bool language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from workspace_members a
    join workspace_members b on b.workspace_id = a.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
  )
$$;

-- A workspace always keeps at least one owner.
create or replace function public.guard_last_owner()
returns trigger language plpgsql as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from public.workspace_members
       where workspace_id = old.workspace_id
         and role = 'owner'
         and user_id <> old.user_id
     )
     -- Allow the cascade when the whole workspace is being deleted.
     and exists (select 1 from public.workspaces where id = old.workspace_id)
  then
    raise exception 'A workspace needs at least one owner.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists workspace_members_last_owner on public.workspace_members;
create trigger workspace_members_last_owner
  before update or delete on public.workspace_members
  for each row execute function public.guard_last_owner();

-- ── Audit log ──────────────────────────────────────────────────────────────

create table if not exists public.audit_log (
  id           bigserial primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  actor_id     uuid,
  actor_type   text not null default 'user' check (actor_type in ('user','api_key','system')),
  action       text not null,
  target_type  text,
  target_id    text,
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists audit_log_ws_time on public.audit_log(workspace_id, created_at desc);

create or replace function public.audit(
  p_workspace uuid, p_action text, p_target_type text default null,
  p_target_id text default null, p_metadata jsonb default '{}'
) returns void language sql security definer set search_path = public as $$
  insert into audit_log (workspace_id, actor_id, actor_type, action, target_type, target_id, metadata)
  values (
    p_workspace, auth.uid(),
    case when auth.uid() is null then 'system' else 'user' end,
    p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}')
  )
$$;

-- ── Workspace RPCs (called from the dashboard) ─────────────────────────────

create or replace function public.slugify(input text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'))
$$;

-- Creates a workspace owned by the caller. `template` is 'support' or 'legal'.
create or replace function public.create_workspace(p_name text, p_template text default 'support')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid    uuid := auth.uid();
  ws     uuid;
  v_base text;
  v_slug text;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if length(coalesce(trim(p_name), '')) = 0 then
    raise exception 'Give the workspace a name.' using errcode = '22023';
  end if;

  v_base := left(nullif(slugify(p_name), ''), 40);
  if v_base is null or length(v_base) < 2 then v_base := 'workspace'; end if;
  v_slug := v_base;
  while exists (select 1 from workspaces w where w.slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text), 1, 5);
  end loop;

  insert into workspaces (name, slug, created_by, features, settings)
  values (
    trim(p_name), v_slug, uid,
    case when p_template = 'legal' then '{"legal": true}'::jsonb else '{}'::jsonb end,
    case when p_template = 'legal'
      then '{"jurisdictions": ["MW"], "default_jurisdiction": "MW", "review_sample_rate": 0.1, "retention_days": 365}'::jsonb
      else '{"retention_days": 365}'::jsonb
    end
  )
  returning id into ws;

  insert into workspace_members (workspace_id, user_id, role) values (ws, uid, 'owner');
  perform audit(ws, 'workspace.created', 'workspace', ws::text, jsonb_build_object('template', p_template));
  return ws;
end;
$$;

-- Returns the raw invite token once; only its hash is stored.
create or replace function public.create_invite(p_workspace uuid, p_email text, p_role text default 'editor')
returns text language plpgsql security definer set search_path = public as $$
declare
  token text := random_token(24);
begin
  if not has_role(p_workspace, 'admin') then
    raise exception 'Only admins can invite people.' using errcode = '42501';
  end if;
  if p_role not in ('admin','editor','reviewer','viewer') then
    raise exception 'Unknown role %', p_role using errcode = '22023';
  end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address does not look right.' using errcode = '22023';
  end if;

  delete from workspace_invites
  where workspace_id = p_workspace and lower(email) = lower(p_email) and accepted_at is null;

  -- Seats: members plus open invites. plan_limit() comes in the next migration;
  -- plpgsql resolves it when the function runs.
  if plan_limit(p_workspace, 'members') is not null and
     (select count(*) from workspace_members where workspace_id = p_workspace)
     + (select count(*) from workspace_invites where workspace_id = p_workspace and accepted_at is null and expires_at > now())
     >= plan_limit(p_workspace, 'members') then
    raise exception 'Your plan allows % members. Upgrade to invite more.', plan_limit(p_workspace, 'members') using errcode = 'P0001';
  end if;

  insert into workspace_invites (workspace_id, email, role, token_hash, invited_by)
  values (p_workspace, lower(trim(p_email)), p_role, sha256_hex(token), auth.uid());

  perform audit(p_workspace, 'member.invited', 'invite', lower(p_email), jsonb_build_object('role', p_role));
  return token;
end;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv   workspace_invites%rowtype;
  email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  select * into inv from workspace_invites
  where token_hash = sha256_hex(p_token) and accepted_at is null and expires_at > now();

  if inv.id is null then
    raise exception 'This invite has expired or was already used.' using errcode = 'P0002';
  end if;
  if inv.email <> email then
    raise exception 'This invite was sent to a different email address.' using errcode = '42501';
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, auth.uid(), inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update workspace_invites set accepted_at = now() where id = inv.id;
  perform audit(inv.workspace_id, 'member.joined', 'user', auth.uid()::text, jsonb_build_object('role', inv.role));
  return inv.workspace_id;
end;
$$;

-- ── Row Level Security ─────────────────────────────────────────────────────

alter table public.plans             enable row level security;
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.audit_log         enable row level security;

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to anon, authenticated using (true);

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_workspace(id) or public.is_platform_admin());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Users may edit their name and avatar, never their admin flag.
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

drop policy if exists workspaces_read on public.workspaces;
create policy workspaces_read on public.workspaces for select to authenticated
  using (id in (select public.my_workspaces('viewer')) or public.is_platform_admin());
drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces for update to authenticated
  using (id in (select public.my_workspaces('admin')))
  with check (id in (select public.my_workspaces('admin')));
drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (id in (select public.my_workspaces('owner')));
-- Plan changes go through billing or a platform admin, not the dashboard.
revoke update on public.workspaces from authenticated;
grant update (name, features, settings) on public.workspaces to authenticated;

drop policy if exists members_read on public.workspace_members;
create policy members_read on public.workspace_members for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists members_update on public.workspace_members;
create policy members_update on public.workspace_members for update to authenticated
  -- Only owners may change an owner's row (USING sees the row before the change).
  using (workspace_id in (select public.my_workspaces('admin'))
         and (role <> 'owner' or public.has_role(workspace_id, 'owner')))
  with check (
    workspace_id in (select public.my_workspaces('admin'))
    and (role <> 'owner' or public.has_role(workspace_id, 'owner'))
  );
drop policy if exists members_delete on public.workspace_members;
create policy members_delete on public.workspace_members for delete to authenticated
  using (
    user_id = auth.uid()
    or (workspace_id in (select public.my_workspaces('admin'))
        and (role <> 'owner' or public.has_role(workspace_id, 'owner')))
  );
-- Members are added only through create_workspace() and accept_invite().

drop policy if exists invites_admin on public.workspace_invites;
create policy invites_admin on public.workspace_invites for select to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));
drop policy if exists invites_delete on public.workspace_invites;
create policy invites_delete on public.workspace_invites for delete to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));

revoke execute on function public.audit(uuid, text, text, text, jsonb) from public, anon, authenticated;
