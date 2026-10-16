-- ============================================================
-- BotDesk v2 — guards and audit trail for changes made through RLS
-- ============================================================
-- RPCs and the admin function write their own audit rows. These triggers
-- cover the security-relevant changes the dashboard makes directly:
-- revoking API keys (which is permanent), changing roles, removing
-- members, deleting provider keys and channels.

-- A revoked key stays revoked: un-revoking would bring back a key that may
-- have leaked, without anyone noticing.
create or replace function public.guard_api_key_revocation()
returns trigger language plpgsql as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked key cannot be restored. Create a new key instead.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists api_keys_revocation_guard on public.api_keys;
create trigger api_keys_revocation_guard before update of revoked_at on public.api_keys
  for each row execute function public.guard_api_key_revocation();

create or replace function public.audit_api_key_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    perform audit(new.workspace_id, 'api_key.revoked', 'api_key', new.prefix, jsonb_build_object('kind', new.kind, 'name', new.name));
  end if;
  return new;
end;
$$;
drop trigger if exists api_keys_audit on public.api_keys;
create trigger api_keys_audit after update of revoked_at on public.api_keys
  for each row execute function public.audit_api_key_change();

create or replace function public.audit_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Skip the cascade when the whole workspace is deleted.
  if not exists (select 1 from workspaces where id = old.workspace_id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    perform audit(old.workspace_id,
      case when old.user_id = auth.uid() then 'member.left' else 'member.removed' end,
      'user', old.user_id::text, jsonb_build_object('role', old.role));
  elsif new.role is distinct from old.role then
    perform audit(new.workspace_id, 'member.role_changed', 'user', new.user_id::text,
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists workspace_members_audit on public.workspace_members;
create trigger workspace_members_audit after update or delete on public.workspace_members
  for each row execute function public.audit_member_change();

create or replace function public.audit_credential_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from workspaces where id = old.workspace_id) then
    perform audit(old.workspace_id,
      case tg_table_name when 'provider_credentials' then 'credential.deleted' else 'channel.deleted' end,
      tg_table_name, old.id::text, '{}');
  end if;
  return old;
end;
$$;
drop trigger if exists provider_credentials_audit on public.provider_credentials;
create trigger provider_credentials_audit after delete on public.provider_credentials
  for each row execute function public.audit_credential_delete();
drop trigger if exists bot_channels_audit on public.bot_channels;
create trigger bot_channels_audit after delete on public.bot_channels
  for each row execute function public.audit_credential_delete();

revoke execute on function public.guard_api_key_revocation() from public, anon, authenticated;
revoke execute on function public.audit_api_key_change() from public, anon, authenticated;
revoke execute on function public.audit_member_change() from public, anon, authenticated;
revoke execute on function public.audit_credential_delete() from public, anon, authenticated;
