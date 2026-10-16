-- Hybrid search, inbox hand-off, review queue and training data.
begin;
select plan(30);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com',    'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'lawyer@example.com',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer@example.com',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 'stranger@example.com', 'authenticated', 'authenticated');

create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;
-- A 1024-d vector pointing mostly along axis i.
create or replace function pg_temp.axis(i int, j int default null) returns vector language sql as $$
  select ('[' || array_to_string(array(
    select case when g = i then 1 when g = j then 0.6 else 0 end from generate_series(1, 1024) g), ',') || ']')::vector
$$;

-- ── Fixtures (as the service) ──────────────────────────────────────────────
insert into workspaces (id, name, slug, features) values
  ('10000000-0000-0000-0000-000000000001', 'LegAI', 'pgtap-legai', '{"legal": true}');
insert into workspace_members values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'reviewer'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'viewer');
insert into knowledge_bases (id, workspace_id, name, embedding_provider, embedding_model, legal) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Laws', 'mock', 'mock-1024', true);
insert into bots (id, workspace_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LegAI Assistant');
insert into sources (id, workspace_id, knowledge_base_id, kind, title, status, jurisdiction, source_type, citation, superseded) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'text', 'Employment Act', 'ready', 'MW', 'statute', 'Employment Act (Cap. 55:01)', false),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'text', 'Kenya Employment Act', 'ready', 'KE', 'statute', null, false),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'text', 'General guide', 'ready', null, 'guidance', null, false),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'text', 'Old Act (repealed)', 'ready', 'MW', 'statute', null, true);
insert into chunks (workspace_id, knowledge_base_id, source_id, ordinal, content, section, embedding) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 0,
   'An employer must give written notice before terminating a contract of employment.', 's. 29', pg_temp.axis(1)),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1,
   'Severance allowance is payable on unfair dismissal.', 's. 35', pg_temp.axis(2)),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 0,
   'Kenyan notice rules for termination.', null, pg_temp.axis(1, 2)),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', 0,
   'Keep copies of every letter your employer gives you.', null, pg_temp.axis(3)),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', 0,
   'Repealed notice rules.', null, pg_temp.axis(1));

-- ── Hybrid search ──────────────────────────────────────────────────────────
select is(
  (select section from match_chunks(array['20000000-0000-0000-0000-000000000001']::uuid[], pg_temp.axis(1), 'notice', 5, '{"jurisdiction": "MW"}') limit 1),
  's. 29', 'closest chunk in the right jurisdiction comes first');
select is(
  (select count(*)::int from match_chunks(array['20000000-0000-0000-0000-000000000001']::uuid[], pg_temp.axis(1), 'notice', 10, '{"jurisdiction": "MW"}')
   where jurisdiction = 'KE'), 0, 'other jurisdictions are filtered out');
select is(
  (select count(*)::int from match_chunks(array['20000000-0000-0000-0000-000000000001']::uuid[], pg_temp.axis(3), 'letter', 10, '{"jurisdiction": "MW"}')
   where title = 'General guide'), 1, 'sources without a jurisdiction apply everywhere');
select is(
  (select count(*)::int from match_chunks(array['20000000-0000-0000-0000-000000000001']::uuid[], pg_temp.axis(1), 'notice', 10, '{}')
   where title like 'Old Act%'), 0, 'superseded sources are left out');
select is(
  (select section from match_chunks(array['20000000-0000-0000-0000-000000000001']::uuid[], null, 'What is severance allowance?', 5, '{"jurisdiction": "MW"}') limit 1),
  's. 35', 'full-text search works without an embedding');
select ok(
  (select bool_and(text_score > 0) from match_chunks(array['20000000-0000-0000-0000-000000000001']::uuid[], null, 'severance', 5, '{}')),
  'full-text matches carry a text score');
select is(
  (select count(*)::int from match_chunks(array['20000000-0000-0000-0000-000000000001']::uuid[], pg_temp.axis(1), 'notice', 10, '{"source_types": ["guidance"]}')),
  1, 'filter by source type');

select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is(
  (select count(*)::int from match_chunks(array['20000000-0000-0000-0000-000000000001']::uuid[], pg_temp.axis(1), 'notice', 10, '{}')),
  0, 'search respects RLS for non-members');
select pg_temp.logout();

-- ── Conversations and hand-off ─────────────────────────────────────────────
insert into bot_channels (id, workspace_id, bot_id, kind) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'whatsapp');
insert into contacts (id, workspace_id, channel, external_id) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'whatsapp', '+265991234567');
insert into conversations (id, workspace_id, bot_id, contact_id, channel, bot_channel_id) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001', 'whatsapp', '50000000-0000-0000-0000-000000000001');
insert into messages (id, workspace_id, conversation_id, role, content, channel_message_id) values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'user', 'Can my boss fire me without notice?', 'wamid.1');
insert into messages (id, workspace_id, conversation_id, role, content, outcome, confidence, citations) values
  ('80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'assistant',
   'No. Your employer must give written notice [1].', 'answered', 0.82, '[{"n": 1, "title": "Employment Act"}]');

select is((select message_count from conversations where id = '70000000-0000-0000-0000-000000000001'), 2, 'message count is kept');
select is((select title from conversations where id = '70000000-0000-0000-0000-000000000001'), 'Can my boss fire me without notice?', 'title comes from the first question');
select throws_ok($$insert into messages (workspace_id, conversation_id, role, content, channel_message_id)
  values ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'user', 'dup', 'wamid.1')$$,
  '23505', null, 'the same WhatsApp message is stored once');

select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$insert into messages (workspace_id, conversation_id, role, content, author_id)
  values ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'agent', 'hi', '00000000-0000-0000-0000-0000000000a3')$$,
  '42501', null, 'viewers cannot reply');

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$insert into messages (workspace_id, conversation_id, role, content, author_id)
  values ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'assistant', 'fake bot', '00000000-0000-0000-0000-0000000000a2')$$,
  '42501', null, 'people cannot post as the bot');
select lives_ok($$insert into messages (workspace_id, conversation_id, role, content, author_id)
  values ('10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'agent', 'A lawyer here: you are owed one month''s notice.', '00000000-0000-0000-0000-0000000000a2')$$,
  'reviewers can reply from the inbox');
select pg_temp.logout();
select is((select status from conversations where id = '70000000-0000-0000-0000-000000000001'), 'handoff', 'a person replying takes over');
select is((select assigned_to from conversations where id = '70000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'and is assigned');
select is((select count(*)::int from jobs where kind = 'deliver_message' and workspace_id = '10000000-0000-0000-0000-000000000001'), 1, 'the WhatsApp reply is queued for sending');
select is((select count(*)::int from jobs where kind = 'notify_handoff' and workspace_id = '10000000-0000-0000-0000-000000000001'), 1, 'the team is notified of the hand-off');

-- ── Review queue → verified answers → training data ────────────────────────
insert into feedback (workspace_id, message_id, rating, comment) values
  ('10000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', -1, 'Too vague');
select is((select reason from review_items where message_id = '80000000-0000-0000-0000-000000000002'), 'negative_feedback',
  'a thumbs-down sends the answer to review');
select is((select question from review_items where message_id = '80000000-0000-0000-0000-000000000002'),
  'Can my boss fire me without notice?', 'the review item carries the question');

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
update review_items set status = 'corrected',
  corrected_answer = 'No. Under section 29 of the Employment Act your employer must give written notice.',
  reviewer_id = auth.uid(), reviewed_at = now()
where message_id = '80000000-0000-0000-0000-000000000002';
select ok(publish_review((select id from review_items where message_id = '80000000-0000-0000-0000-000000000002'), '20000000-0000-0000-0000-000000000001') is not null,
  'a reviewer can publish the corrected answer');
select pg_temp.logout();
select is((select source_type from sources where kind = 'qa' and workspace_id = '10000000-0000-0000-0000-000000000001'), 'verified_answer', 'it becomes a verified-answer source');
select is((select status from sources where kind = 'qa' and workspace_id = '10000000-0000-0000-0000-000000000001'), 'queued', 'which is queued for indexing');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into datasets (id, workspace_id, name) values
  ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Employment answers');
select is(collect_examples('90000000-0000-0000-0000-000000000001'), 1, 'corrected answers become training examples');
select is(collect_examples('90000000-0000-0000-0000-000000000001'), 0, 'collecting twice adds nothing');
select is((select messages -> 1 ->> 'content' from dataset_examples limit 1),
  'No. Under section 29 of the Employment Act your employer must give written notice.', 'the example uses the corrected answer');
select lives_ok($$insert into finetune_jobs (workspace_id, dataset_id, provider, base_model)
  values ('10000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'together', 'Qwen/Qwen3.5-9B')$$,
  'admins can start a fine-tune');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$insert into finetune_jobs (workspace_id, dataset_id, provider, base_model)
  values ('10000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'together', 'x')$$,
  '42501', null, 'reviewers cannot start a fine-tune');
select pg_temp.logout();
select is((select count(*)::int from jobs where kind = 'finetune_submit' and workspace_id = '10000000-0000-0000-0000-000000000001'), 1, 'the fine-tune is queued');

-- ── Usage ──────────────────────────────────────────────────────────────────
select record_usage('10000000-0000-0000-0000-000000000001', null, 'chat', 'anthropic', 'claude-haiku-5-5', 100, 50, 0.0001, true, 1);
select is((message_quota('10000000-0000-0000-0000-000000000001') ->> 'used')::int, 1, 'answered messages are counted');

select * from finish();
rollback;
