-- ============================================================
-- BotDesk v2 — background jobs, rate limits, usage metering
-- ============================================================

-- ── Jobs ───────────────────────────────────────────────────────────────────
-- A small Postgres queue. The `worker` Edge Function claims jobs with
-- FOR UPDATE SKIP LOCKED, so several workers can run at once. pg_cron calls
-- the worker every minute; enqueue_job() also nudges it right away when
-- pg_net and the Vault secrets below are configured.
--
-- Kinds: ingest_source, embed_chunks, deliver_message, notify_handoff,
--        finetune_submit, finetune_poll, eval_run, refresh_sources, purge

create table if not exists public.jobs (
  id           bigserial primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  kind         text not null,
  payload      jsonb not null default '{}',
  status       text not null default 'queued' check (status in ('queued','running','done','failed','dead')),
  priority     int  not null default 0,
  attempts     int  not null default 0,
  max_attempts int  not null default 5,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists jobs_ready on public.jobs(priority desc, id) where status = 'queued';
create index if not exists jobs_running on public.jobs(locked_at) where status = 'running';
create index if not exists jobs_finished on public.jobs(finished_at) where status in ('done','dead');

alter table public.jobs enable row level security;   -- service role only

-- Calls the worker now instead of waiting for the next cron tick.
-- Needs pg_net and two Vault secrets: botdesk_project_url, botdesk_worker_secret.
create or replace function public.kick_worker()
returns void language plpgsql security definer set search_path = public as $$
declare
  url    text;
  secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'botdesk_project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'botdesk_worker_secret';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(url, '/') || '/functions/v1/worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', secret),
    body := '{"reason":"kick"}'::jsonb,
    timeout_milliseconds := 2000
  );
exception when others then
  -- Never fail the caller's transaction; cron will pick the job up.
  null;
end;
$$;

create or replace function public.enqueue_job(
  p_workspace uuid,
  p_kind      text,
  p_payload   jsonb default '{}',
  p_delay     interval default '0 seconds',
  p_priority  int default 0
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  new_id bigint;
  recent bool;
begin
  select exists (
    select 1 from jobs where status = 'queued' and created_at > now() - interval '2 seconds'
  ) into recent;

  insert into jobs (workspace_id, kind, payload, run_after, priority)
  values (p_workspace, p_kind, coalesce(p_payload, '{}'), now() + p_delay, p_priority)
  returning id into new_id;

  -- One nudge per burst is enough; a running worker drains the queue.
  if not recent and p_delay = '0 seconds' then
    perform kick_worker();
  end if;
  return new_id;
end;
$$;

create or replace function public.claim_jobs(p_worker text, p_limit int default 5, p_kinds text[] default null)
returns setof public.jobs language plpgsql security definer set search_path = public as $$
begin
  -- Jobs whose worker died mid-run go back to the queue.
  update jobs set status = 'queued', locked_at = null, locked_by = null
  where status = 'running' and locked_at < now() - interval '10 minutes';

  return query
  update jobs j set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
  where j.id in (
    select id from jobs
    where status = 'queued' and run_after <= now()
      and (p_kinds is null or kind = any(p_kinds))
    order by priority desc, id
    for update skip locked
    limit p_limit
  )
  returning j.*;
end;
$$;

create or replace function public.finish_job(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update jobs set status = 'done', finished_at = now(), locked_at = null, last_error = null where id = p_id
$$;

-- Retries with exponential backoff (30s, 2m, 8m, ...), then gives up.
create or replace function public.fail_job(p_id bigint, p_error text, p_retry bool default true)
returns text language plpgsql security definer set search_path = public as $$
declare
  j jobs%rowtype;
begin
  select * into j from jobs where id = p_id;
  if not found then return null; end if;
  if p_retry and j.attempts < j.max_attempts then
    update jobs set status = 'queued', locked_at = null, last_error = left(p_error, 2000),
      run_after = now() + make_interval(secs => 30 * power(4, greatest(j.attempts - 1, 0)))
    where id = p_id;
    return 'queued';
  end if;
  update jobs set status = 'dead', finished_at = now(), locked_at = null, last_error = left(p_error, 2000)
  where id = p_id;
  return 'dead';
end;
$$;

-- Lets a long job continue in the next worker run without counting a failure.
create or replace function public.defer_job(p_id bigint, p_payload jsonb, p_delay interval default '1 second')
returns void language sql security definer set search_path = public as $$
  update jobs set status = 'queued', locked_at = null, payload = p_payload,
    attempts = greatest(attempts - 1, 0), run_after = now() + p_delay
  where id = p_id
$$;

-- ── Rate limits ────────────────────────────────────────────────────────────

create table if not exists public.rate_limits (
  key    text   not null,
  bucket bigint not null,
  count  int    not null default 0,
  expires_at timestamptz not null default now() + interval '1 day',
  primary key (key, bucket)
);
alter table public.rate_limits enable row level security;   -- service role only

-- True if this hit is within `p_limit` per `p_window_seconds`.
create or replace function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int default 60)
returns bool language plpgsql security definer set search_path = public as $$
declare
  b bigint := floor(extract(epoch from now()) / p_window_seconds);
  n int;
begin
  insert into rate_limits (key, bucket, count, expires_at)
  values (p_key, b, 1, now() + make_interval(secs => p_window_seconds * 2))
  on conflict (key, bucket) do update set count = rate_limits.count + 1
  returning count into n;
  return n <= p_limit;
end;
$$;

-- ── Usage ──────────────────────────────────────────────────────────────────

create table if not exists public.usage_events (
  id            bigserial primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  bot_id        uuid references public.bots(id) on delete set null,
  kind          text not null check (kind in ('chat','embedding','analysis','eval','finetune')),
  provider      text,
  model         text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cost_usd      numeric(12, 6) not null default 0,
  platform_key  bool not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists usage_events_ws_time on public.usage_events(workspace_id, created_at desc);

create table if not exists public.usage_monthly (
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  period           date not null,                -- first day of the month
  messages         int not null default 0,       -- answered user messages
  input_tokens     bigint not null default 0,
  output_tokens    bigint not null default 0,
  embedding_tokens bigint not null default 0,
  cost_usd         numeric(14, 6) not null default 0,
  primary key (workspace_id, period)
);

create or replace function public.record_usage(
  p_workspace uuid, p_bot uuid, p_kind text, p_provider text, p_model text,
  p_input int, p_output int, p_cost numeric, p_platform bool default false, p_messages int default 0
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into usage_events (workspace_id, bot_id, kind, provider, model, input_tokens, output_tokens, cost_usd, platform_key)
  values (p_workspace, p_bot, p_kind, p_provider, p_model, coalesce(p_input, 0), coalesce(p_output, 0), coalesce(p_cost, 0), p_platform);

  insert into usage_monthly (workspace_id, period, messages, input_tokens, output_tokens, embedding_tokens, cost_usd)
  values (
    p_workspace, date_trunc('month', now())::date, coalesce(p_messages, 0),
    case when p_kind = 'embedding' then 0 else coalesce(p_input, 0) end,
    coalesce(p_output, 0),
    case when p_kind = 'embedding' then coalesce(p_input, 0) else 0 end,
    coalesce(p_cost, 0)
  )
  on conflict (workspace_id, period) do update set
    messages         = usage_monthly.messages + excluded.messages,
    input_tokens     = usage_monthly.input_tokens + excluded.input_tokens,
    output_tokens    = usage_monthly.output_tokens + excluded.output_tokens,
    embedding_tokens = usage_monthly.embedding_tokens + excluded.embedding_tokens,
    cost_usd         = usage_monthly.cost_usd + excluded.cost_usd;
end;
$$;

-- {allowed, used, limit} for this month's answered messages.
create or replace function public.message_quota(p_workspace uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'used', coalesce(u.messages, 0),
    'limit', plan_limit(p_workspace, 'messages_per_month'),
    'allowed', plan_limit(p_workspace, 'messages_per_month') is null
               or coalesce(u.messages, 0) < plan_limit(p_workspace, 'messages_per_month')
  )
  from (select 1) one
  left join usage_monthly u on u.workspace_id = p_workspace and u.period = date_trunc('month', now())::date
$$;

alter table public.usage_events  enable row level security;
alter table public.usage_monthly enable row level security;

drop policy if exists usage_events_read on public.usage_events;
create policy usage_events_read on public.usage_events for select to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));
drop policy if exists usage_monthly_read on public.usage_monthly;
create policy usage_monthly_read on public.usage_monthly for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));

-- Internal functions: service role only.
revoke execute on function public.kick_worker() from public, anon, authenticated;
revoke execute on function public.enqueue_job(uuid, text, jsonb, interval, int) from public, anon, authenticated;
revoke execute on function public.claim_jobs(text, int, text[]) from public, anon, authenticated;
revoke execute on function public.finish_job(bigint) from public, anon, authenticated;
revoke execute on function public.fail_job(bigint, text, bool) from public, anon, authenticated;
revoke execute on function public.defer_job(bigint, jsonb, interval) from public, anon, authenticated;
revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
revoke execute on function public.record_usage(uuid, uuid, text, text, text, int, int, numeric, bool, int) from public, anon, authenticated;
grant execute on function public.enqueue_job(uuid, text, jsonb, interval, int) to service_role;
grant execute on function public.claim_jobs(text, int, text[]) to service_role;
grant execute on function public.finish_job(bigint) to service_role;
grant execute on function public.fail_job(bigint, text, bool) to service_role;
grant execute on function public.defer_job(bigint, jsonb, interval) to service_role;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;
grant execute on function public.record_usage(uuid, uuid, text, text, text, int, int, numeric, bool, int) to service_role;
revoke execute on function public.message_quota(uuid) from public, anon, authenticated;
grant execute on function public.message_quota(uuid) to service_role;
revoke execute on function public.plan_limit(uuid, text) from public, anon;
