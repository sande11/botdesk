-- ============================================================
-- BotDesk v2 — step 0: move the v1 schema out of the way
-- ============================================================
-- v1 kept one owner per account and question/answer "kb_entries".
-- v2 replaces it with workspaces, members, bots, knowledge bases and
-- documents. The v1 tables move to a private `legacy` schema here; their
-- rows are copied into the new tables in 20261015000900_import_legacy.sql.
-- Nothing is dropped, so the copy can be checked before `legacy` is removed.

create schema if not exists legacy;
revoke all on schema legacy from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'apps', 'app_api_keys', 'app_settings', 'kb_entries',
    'conversations', 'messages', 'escalations', 'rate_limits'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I set schema legacy', t);
    end if;
  end loop;
end;
$$;

-- v1 triggers and functions that the new schema replaces.
drop trigger if exists messages_bump_last on legacy.messages;
drop function if exists public.bump_conversation_last_message();
drop function if exists public.increment_rate_limit(uuid, text, bigint);
drop function if exists public.match_kb_entries(uuid, vector, float4, int);
-- Also drops the v1 policies on the legacy tables (RLS stays on, so they
-- become unreadable to API users; only migrations and the service role read them).
drop function if exists public.auth_account_id() cascade;

-- v1 cron jobs reference tables that no longer exist in `public`.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname)
    from cron.job
    where jobname in ('cleanup-rate-limits', 'retry-escalations');
  end if;
end;
$$;
