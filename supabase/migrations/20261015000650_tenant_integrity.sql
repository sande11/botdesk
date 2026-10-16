-- ============================================================
-- BotDesk v2 — cross-tenant integrity
-- ============================================================
-- RLS checks the workspace_id of the row being written, but a row could
-- still point at a parent in ANOTHER workspace (e.g. a custom model using
-- someone else's API key, or an example added to someone else's dataset).
-- Composite foreign keys (child.parent_id, child.workspace_id) ->
-- (parent.id, parent.workspace_id) make that impossible.

do $$
declare
  t text;
begin
  foreach t in array array[
    'provider_credentials','bots','knowledge_bases','sources','contacts',
    'conversations','messages','datasets','eval_sets','eval_cases','eval_runs'
  ] loop
    if not exists (select 1 from pg_constraint where conname = t || '_id_workspace_key') then
      execute format('alter table public.%I add constraint %I unique (id, workspace_id)', t, t || '_id_workspace_key');
    end if;
  end loop;
end;
$$;

-- Replaces a single-column FK with a composite one.
create or replace function pg_temp.same_ws_fk(
  child text, col text, parent text, on_delete text
) returns void language plpgsql as $$
declare
  old_fk text;
begin
  select c.conname into old_fk
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.conrelid = ('public.' || child)::regclass
    and c.contype = 'f' and array_length(c.conkey, 1) = 1 and a.attname = col;
  if old_fk is not null then
    execute format('alter table public.%I drop constraint %I', child, old_fk);
  end if;
  execute format(
    'alter table public.%I add constraint %I foreign key (%I, workspace_id) references public.%I (id, workspace_id) on delete %s',
    child, child || '_' || col || '_same_ws', col, parent, on_delete
  );
end;
$$;

select pg_temp.same_ws_fk('custom_models',       'credential_id',     'provider_credentials', 'set null (credential_id)');
select pg_temp.same_ws_fk('bot_channels',        'bot_id',            'bots',                 'cascade');
select pg_temp.same_ws_fk('api_keys',            'bot_id',            'bots',                 'cascade');
select pg_temp.same_ws_fk('bot_knowledge_bases', 'bot_id',            'bots',                 'cascade');
select pg_temp.same_ws_fk('bot_knowledge_bases', 'knowledge_base_id', 'knowledge_bases',      'cascade');
select pg_temp.same_ws_fk('sources',             'knowledge_base_id', 'knowledge_bases',      'cascade');
select pg_temp.same_ws_fk('sources',             'parent_id',         'sources',              'cascade');
select pg_temp.same_ws_fk('chunks',              'source_id',         'sources',              'cascade');
select pg_temp.same_ws_fk('chunks',              'knowledge_base_id', 'knowledge_bases',      'cascade');
select pg_temp.same_ws_fk('conversations',       'bot_id',            'bots',                 'cascade');
select pg_temp.same_ws_fk('conversations',       'contact_id',        'contacts',             'cascade');
select pg_temp.same_ws_fk('messages',            'conversation_id',   'conversations',        'cascade');
select pg_temp.same_ws_fk('feedback',            'message_id',        'messages',             'cascade');
select pg_temp.same_ws_fk('review_items',        'bot_id',            'bots',                 'set null (bot_id)');
select pg_temp.same_ws_fk('review_items',        'conversation_id',   'conversations',        'set null (conversation_id)');
select pg_temp.same_ws_fk('review_items',        'message_id',        'messages',             'set null (message_id)');
select pg_temp.same_ws_fk('review_items',        'published_source_id','sources',             'set null (published_source_id)');
select pg_temp.same_ws_fk('dataset_examples',    'dataset_id',        'datasets',             'cascade');
select pg_temp.same_ws_fk('finetune_jobs',       'dataset_id',        'datasets',             'restrict');
select pg_temp.same_ws_fk('eval_cases',          'eval_set_id',       'eval_sets',            'cascade');
select pg_temp.same_ws_fk('eval_runs',           'eval_set_id',       'eval_sets',            'cascade');
select pg_temp.same_ws_fk('eval_runs',           'bot_id',            'bots',                 'cascade');
select pg_temp.same_ws_fk('eval_results',        'run_id',            'eval_runs',            'cascade');
select pg_temp.same_ws_fk('eval_results',        'case_id',           'eval_cases',           'cascade');
select pg_temp.same_ws_fk('usage_events',        'bot_id',            'bots',                 'set null (bot_id)');
