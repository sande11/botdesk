-- ============================================================
-- BotDesk v2 — secrets in Supabase Vault
-- ============================================================
-- Model provider keys and channel tokens are encrypted by Vault. Only the
-- service role (Edge Functions) can store or read them, through these
-- wrappers. The dashboard never sees a secret after it is saved.

create or replace function public.store_secret(p_secret text, p_name text, p_existing uuid default null)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  sid uuid;
begin
  if p_existing is not null and exists (select 1 from vault.secrets where id = p_existing) then
    perform vault.update_secret(p_existing, p_secret);
    return p_existing;
  end if;
  select vault.create_secret(p_secret, p_name || ':' || gen_random_uuid()::text, 'BotDesk') into sid;
  return sid;
end;
$$;

create or replace function public.read_secret(p_id uuid)
returns text language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id
$$;

create or replace function public.delete_secret(p_id uuid)
returns void language sql security definer set search_path = public, vault as $$
  delete from vault.secrets where id = p_id
$$;

revoke execute on function public.store_secret(text, text, uuid) from public, anon, authenticated;
revoke execute on function public.read_secret(uuid) from public, anon, authenticated;
revoke execute on function public.delete_secret(uuid) from public, anon, authenticated;
grant execute on function public.store_secret(text, text, uuid) to service_role;
grant execute on function public.read_secret(uuid) to service_role;
grant execute on function public.delete_secret(uuid) to service_role;

-- Removing a credential or channel removes its secret.
create or replace function public.drop_linked_secret()
returns trigger language plpgsql security definer set search_path = public, vault as $$
begin
  if old.secret_id is not null then
    delete from vault.secrets where id = old.secret_id;
  end if;
  return old;
end;
$$;

drop trigger if exists provider_credentials_drop_secret on public.provider_credentials;
create trigger provider_credentials_drop_secret after delete on public.provider_credentials
  for each row execute function public.drop_linked_secret();
drop trigger if exists bot_channels_drop_secret on public.bot_channels;
create trigger bot_channels_drop_secret after delete on public.bot_channels
  for each row execute function public.drop_linked_secret();
