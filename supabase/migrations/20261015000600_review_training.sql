-- ============================================================
-- BotDesk v2 — review queue, training data, fine-tuning, evals
-- ============================================================
-- Reviewed answers are the backbone of quality:
--   1. Answers with low confidence, a thumbs-down, or a random sample land
--      in the review queue.
--   2. A reviewer (e.g. a lawyer for LegAI) approves or corrects them.
--   3. Corrections can be published back into a knowledge base as a
--      "verified answer" source, and added to a training dataset.
--   4. Datasets export as JSONL and can start a fine-tune job with a
--      provider; the resulting model can then be chosen for a bot.
--   5. Eval sets measure a bot before and after each change.

create table if not exists public.review_items (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  bot_id           uuid references public.bots(id) on delete set null,
  conversation_id  uuid references public.conversations(id) on delete set null,
  message_id       uuid references public.messages(id) on delete set null,
  question         text not null,
  answer           text not null,
  citations        jsonb not null default '[]',
  jurisdiction     text,
  reason           text not null check (reason in ('low_confidence','negative_feedback','sampled','no_answer','manual')),
  status           text not null default 'pending' check (status in ('pending','approved','corrected','rejected')),
  corrected_answer text,
  notes            text,
  reviewer_id      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  published_source_id uuid references public.sources(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists review_items_queue on public.review_items(workspace_id, status, created_at desc);
create unique index if not exists review_items_one_per_message on public.review_items(message_id) where message_id is not null;

-- A thumbs-down from a visitor puts the answer in the review queue.
create or replace function public.review_on_negative_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m   messages%rowtype;
  q   text;
  c   conversations%rowtype;
begin
  if new.rating <> -1 then return new; end if;
  select * into m from messages where id = new.message_id;
  if m.role <> 'assistant' then return new; end if;
  select * into c from conversations where id = m.conversation_id;
  select content into q from messages
    where conversation_id = m.conversation_id and role = 'user' and created_at <= m.created_at
    order by created_at desc limit 1;

  insert into review_items (workspace_id, bot_id, conversation_id, message_id, question, answer, citations, jurisdiction, reason, notes)
  values (m.workspace_id, c.bot_id, c.id, m.id, coalesce(q, ''), m.content, m.citations, c.jurisdiction, 'negative_feedback', new.comment)
  on conflict (message_id) where message_id is not null do update set
    reason = 'negative_feedback',
    status = case when review_items.status = 'approved' then 'pending' else review_items.status end,
    notes  = coalesce(excluded.notes, review_items.notes);
  return new;
end;
$$;
drop trigger if exists feedback_review on public.feedback;
create trigger feedback_review after insert on public.feedback
  for each row execute function public.review_on_negative_feedback();

-- Publishes a reviewed answer as a "verified answer" Q&A source.
create or replace function public.publish_review(p_review uuid, p_knowledge_base uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r   review_items%rowtype;
  sid uuid;
begin
  select * into r from review_items where id = p_review;
  if r.id is null or not has_role(r.workspace_id, 'reviewer') then
    raise exception 'Review item not found.' using errcode = 'P0002';
  end if;
  if r.status not in ('approved','corrected') then
    raise exception 'Approve or correct the answer before publishing it.' using errcode = '22023';
  end if;
  -- Approving the bot's "I couldn't find that" must not publish it.
  if r.reason = 'no_answer' and (r.status <> 'corrected' or coalesce(trim(r.corrected_answer), '') = '') then
    raise exception 'Write the answer before publishing it.' using errcode = '22023';
  end if;
  if not exists (select 1 from knowledge_bases where id = p_knowledge_base and workspace_id = r.workspace_id) then
    raise exception 'Knowledge base is not in this workspace.' using errcode = '22023';
  end if;

  insert into sources (workspace_id, knowledge_base_id, kind, title, question, content, jurisdiction, source_type, metadata, created_by)
  values (
    r.workspace_id, p_knowledge_base, 'qa', left(r.question, 200), r.question,
    coalesce(nullif(r.corrected_answer, ''), r.answer), r.jurisdiction, 'verified_answer',
    jsonb_build_object('review_item_id', r.id, 'reviewed_by', r.reviewer_id, 'reviewed_at', r.reviewed_at),
    auth.uid()
  )
  returning id into sid;

  update review_items set published_source_id = sid where id = r.id;
  perform audit(r.workspace_id, 'review.published', 'source', sid::text, jsonb_build_object('review_item_id', r.id));
  return sid;
end;
$$;

-- ── Datasets and fine-tuning ───────────────────────────────────────────────

create table if not exists public.datasets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  -- System prompt used for every example when exporting.
  system_prompt text not null default '',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.dataset_examples (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dataset_id   uuid not null references public.datasets(id) on delete cascade,
  -- Chat format: [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
  messages     jsonb not null check (jsonb_typeof(messages) = 'array'),
  origin       text not null default 'manual' check (origin in ('review','feedback','manual','import')),
  origin_id    uuid,
  approved     bool not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists dataset_examples_ds on public.dataset_examples(dataset_id);
create unique index if not exists dataset_examples_origin on public.dataset_examples(dataset_id, origin_id) where origin_id is not null;

-- Adds approved/corrected review items (and thumbs-up answers) to a dataset.
create or replace function public.collect_examples(p_dataset uuid, p_include_positive bool default true, p_since timestamptz default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  ds    datasets%rowtype;
  added int := 0;
  n     int;
begin
  select * into ds from datasets where id = p_dataset;
  if ds.id is null or not has_role(ds.workspace_id, 'editor') then
    raise exception 'Dataset not found.' using errcode = 'P0002';
  end if;

  insert into dataset_examples (workspace_id, dataset_id, messages, origin, origin_id)
  select r.workspace_id, ds.id,
    jsonb_build_array(
      jsonb_build_object('role', 'user', 'content', r.question),
      jsonb_build_object('role', 'assistant', 'content', coalesce(nullif(r.corrected_answer, ''), r.answer))
    ),
    'review', r.id
  from review_items r
  where r.workspace_id = ds.workspace_id
    and r.status in ('approved','corrected')
    -- The bot's own "I couldn't find that" is not an example of a good answer.
    and (r.reason <> 'no_answer' or nullif(trim(r.corrected_answer), '') is not null)
    and (p_since is null or r.reviewed_at >= p_since)
  on conflict do nothing;
  get diagnostics n = row_count;
  added := added + n;

  if p_include_positive then
    insert into dataset_examples (workspace_id, dataset_id, messages, origin, origin_id)
    select m.workspace_id, ds.id,
      jsonb_build_array(
        jsonb_build_object('role', 'user', 'content', q.content),
        jsonb_build_object('role', 'assistant', 'content', m.content)
      ),
      'feedback', m.id
    from feedback f
    join messages m on m.id = f.message_id and m.role = 'assistant' and m.outcome = 'answered'
    cross join lateral (
      select content from messages u
      where u.conversation_id = m.conversation_id and u.role = 'user' and u.created_at <= m.created_at
      order by u.created_at desc limit 1
    ) q
    where f.workspace_id = ds.workspace_id and f.rating = 1
      and (p_since is null or f.created_at >= p_since)
      -- An answer later corrected in review is not a good example.
      and not exists (select 1 from review_items r where r.message_id = m.id and r.status in ('corrected','rejected'))
    on conflict do nothing;
    get diagnostics n = row_count;
    added := added + n;
  end if;
  return added;
end;
$$;

create table if not exists public.finetune_jobs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  dataset_id       uuid not null references public.datasets(id) on delete restrict,
  provider         text not null check (provider in ('openai','together')),
  base_model       text not null,
  suffix           text,
  hyperparameters  jsonb not null default '{}',
  status           text not null default 'queued'
                   check (status in ('queued','uploading','submitted','running','succeeded','failed','cancelled')),
  example_count    int,
  provider_file_id text,
  provider_job_id  text,
  result_model     text,
  error            text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz
);

drop trigger if exists finetune_jobs_updated_at on public.finetune_jobs;
create trigger finetune_jobs_updated_at before update on public.finetune_jobs
  for each row execute function public.touch_updated_at();

create or replace function public.queue_finetune()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform enqueue_job(new.workspace_id, 'finetune_submit', jsonb_build_object('finetune_job_id', new.id));
  perform audit(new.workspace_id, 'finetune.started', 'finetune_job', new.id::text,
                jsonb_build_object('provider', new.provider, 'base_model', new.base_model));
  return new;
end;
$$;
drop trigger if exists finetune_jobs_queue on public.finetune_jobs;
create trigger finetune_jobs_queue after insert on public.finetune_jobs
  for each row execute function public.queue_finetune();

-- ── Evals ──────────────────────────────────────────────────────────────────

create table if not exists public.eval_sets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.eval_cases (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  eval_set_id     uuid not null references public.eval_sets(id) on delete cascade,
  question        text not null,
  -- What a good answer must say (graded by a model), and/or sources it should cite.
  expected_answer text not null default '',
  expected_source_ids uuid[] not null default '{}',
  -- Questions the bot should decline (out of scope).
  should_decline  bool not null default false,
  jurisdiction    text,
  created_at      timestamptz not null default now()
);
create index if not exists eval_cases_set on public.eval_cases(eval_set_id);

create table if not exists public.eval_runs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  eval_set_id  uuid not null references public.eval_sets(id) on delete cascade,
  bot_id       uuid not null references public.bots(id) on delete cascade,
  -- Try another model without changing the bot: {"provider", "model", "custom_model_id"}
  model_override jsonb,
  status       text not null default 'queued' check (status in ('queued','running','done','failed')),
  -- answered_rate, correctness, faithfulness, citation_rate, source_recall,
  -- decline_accuracy, avg_latency_ms, cases
  metrics      jsonb not null default '{}',
  error        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table if not exists public.eval_results (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id       uuid not null references public.eval_runs(id) on delete cascade,
  case_id      uuid not null references public.eval_cases(id) on delete cascade,
  answer       text,
  outcome      text,
  citations    jsonb not null default '[]',
  retrieved_source_ids uuid[] not null default '{}',
  -- {"correctness": 0..1, "faithfulness": 0..1, "source_hit": bool, "declined": bool, "notes": "..."}
  scores       jsonb not null default '{}',
  latency_ms   int,
  created_at   timestamptz not null default now(),
  unique (run_id, case_id)
);

create or replace function public.queue_eval_run()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform enqueue_job(new.workspace_id, 'eval_run', jsonb_build_object('eval_run_id', new.id));
  return new;
end;
$$;
drop trigger if exists eval_runs_queue on public.eval_runs;
create trigger eval_runs_queue after insert on public.eval_runs
  for each row execute function public.queue_eval_run();

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.review_items     enable row level security;
alter table public.datasets         enable row level security;
alter table public.dataset_examples enable row level security;
alter table public.finetune_jobs    enable row level security;
alter table public.eval_sets        enable row level security;
alter table public.eval_cases       enable row level security;
alter table public.eval_runs        enable row level security;
alter table public.eval_results     enable row level security;

drop policy if exists review_read on public.review_items;
create policy review_read on public.review_items for select to authenticated
  using (workspace_id in (select public.my_workspaces('reviewer')));
drop policy if exists review_update on public.review_items;
create policy review_update on public.review_items for update to authenticated
  using (workspace_id in (select public.my_workspaces('reviewer')))
  with check (workspace_id in (select public.my_workspaces('reviewer')));
drop policy if exists review_insert on public.review_items;
create policy review_insert on public.review_items for insert to authenticated
  with check (workspace_id in (select public.my_workspaces('reviewer')) and reason = 'manual');
revoke update on public.review_items from authenticated;
grant update (status, corrected_answer, notes, reviewer_id, reviewed_at) on public.review_items to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['datasets','dataset_examples','eval_sets','eval_cases'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (workspace_id in (select public.my_workspaces(''viewer'')))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (workspace_id in (select public.my_workspaces(''editor''))) with check (workspace_id in (select public.my_workspaces(''editor'')))', t || '_write', t);
  end loop;
end;
$$;

drop policy if exists finetune_read on public.finetune_jobs;
create policy finetune_read on public.finetune_jobs for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists finetune_insert on public.finetune_jobs;
create policy finetune_insert on public.finetune_jobs for insert to authenticated
  with check (workspace_id in (select public.my_workspaces('admin')) and status = 'queued'
              and exists (select 1 from public.datasets d where d.id = dataset_id and d.workspace_id = finetune_jobs.workspace_id));
revoke update, delete on public.finetune_jobs from authenticated;

drop policy if exists eval_runs_read on public.eval_runs;
create policy eval_runs_read on public.eval_runs for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists eval_runs_insert on public.eval_runs;
create policy eval_runs_insert on public.eval_runs for insert to authenticated
  with check (workspace_id in (select public.my_workspaces('editor')) and status = 'queued'
              and exists (select 1 from public.bots b where b.id = bot_id and b.workspace_id = eval_runs.workspace_id)
              and exists (select 1 from public.eval_sets s where s.id = eval_set_id and s.workspace_id = eval_runs.workspace_id));
drop policy if exists eval_runs_delete on public.eval_runs;
create policy eval_runs_delete on public.eval_runs for delete to authenticated
  using (workspace_id in (select public.my_workspaces('editor')));
revoke update on public.eval_runs from authenticated;

drop policy if exists eval_results_read on public.eval_results;
create policy eval_results_read on public.eval_results for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
revoke insert, update, delete on public.eval_results from authenticated;
