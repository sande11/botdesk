-- ============================================================
-- BotDesk v2 — file storage, scheduled work, housekeeping
-- ============================================================

-- ── Storage: uploaded documents ────────────────────────────────────────────
-- Path: <workspace_id>/<source_id>/<file name>

insert into storage.buckets (id, name, public, file_size_limit)
values ('sources', 'sources', false, 52428800)
on conflict (id) do nothing;

create or replace function public.storage_workspace(object_name text)
returns uuid language plpgsql immutable as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "sources: members read" on storage.objects;
create policy "sources: members read" on storage.objects for select to authenticated
  using (bucket_id = 'sources' and public.storage_workspace(name) in (select public.my_workspaces('viewer')));
drop policy if exists "sources: editors upload" on storage.objects;
create policy "sources: editors upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sources' and public.storage_workspace(name) in (select public.my_workspaces('editor')));
drop policy if exists "sources: editors delete" on storage.objects;
create policy "sources: editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sources' and public.storage_workspace(name) in (select public.my_workspaces('editor')));

-- Deleting a source removes its file.
create or replace function public.queue_source_file_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.storage_path is not null then
    -- When the whole workspace is being deleted the job can't reference it.
    perform enqueue_job(
      case when exists (select 1 from workspaces where id = old.workspace_id) then old.workspace_id end,
      'delete_file', jsonb_build_object('bucket', 'sources', 'path', old.storage_path), '5 seconds');
  end if;
  return old;
end;
$$;
drop trigger if exists sources_file_cleanup on public.sources;
create trigger sources_file_cleanup after delete on public.sources
  for each row execute function public.queue_source_file_cleanup();

-- ── Housekeeping ───────────────────────────────────────────────────────────

create or replace function public.housekeeping()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  purged_conversations int;
  purged_jobs int;
  purged_limits int;
begin
  delete from rate_limits where expires_at < now();
  get diagnostics purged_limits = row_count;

  delete from jobs where status in ('done','dead') and finished_at < now() - interval '14 days';
  get diagnostics purged_jobs = row_count;

  -- Each workspace keeps conversations for settings.retention_days (0 = forever).
  delete from conversations c
  using workspaces w
  where c.workspace_id = w.id
    and coalesce((w.settings ->> 'retention_days')::int, 0) > 0
    and c.last_message_at < now() - make_interval(days => (w.settings ->> 'retention_days')::int);
  get diagnostics purged_conversations = row_count;

  delete from contacts ct
  where not exists (select 1 from conversations c where c.contact_id = ct.id)
    and ct.last_seen_at < now() - interval '30 days';

  return jsonb_build_object('conversations', purged_conversations, 'jobs', purged_jobs, 'rate_limits', purged_limits);
end;
$$;

-- Sources with refresh_hours are re-fetched and re-indexed when due.
create or replace function public.queue_due_refreshes()
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update sources set status = 'queued'
  where refresh_hours is not null
    and status = 'ready'
    and kind in ('url','sitemap')
    and coalesce(last_indexed_at, created_at) < now() - make_interval(hours => refresh_hours);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.housekeeping() from public, anon, authenticated;
revoke execute on function public.queue_due_refreshes() from public, anon, authenticated;

-- ── Schedules (pg_cron + pg_net) ───────────────────────────────────────────
-- The worker needs two Vault secrets (see README → Deploy):
--   select vault.create_secret('https://<ref>.supabase.co', 'botdesk_project_url');
--   select vault.create_secret('<same value as WORKER_SECRET>', 'botdesk_worker_secret');

do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'pg_net not available: %', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available: %', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('botdesk-worker', '* * * * *', 'select public.kick_worker()');
    perform cron.schedule('botdesk-refresh-sources', '7 * * * *', 'select public.queue_due_refreshes()');
    perform cron.schedule('botdesk-housekeeping', '17 3 * * *', 'select public.housekeeping()');
  end if;
end;
$$;
