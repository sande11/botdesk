-- Run with: supabase test db
-- Two users in two workspaces; checks that each sees only their own data
-- and that roles limit what members can do.
begin;
select plan(48);

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.com',  '{"full_name": "Ada"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'ben@example.com',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'cleo@example.com', '{}', 'authenticated', 'authenticated');

create or replace function pg_temp.login(uid uuid, email text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', uid, 'email', email, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.logout() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

select is((select count(*)::int from profiles where id in (
  '00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b')), 2,
  'sign-up creates profiles');

-- ── Ada creates a workspace; Ben creates another ───────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'ada@example.com');
create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values ('ws_a', create_workspace('Ada Legal', 'legal'));
select is((select role from workspace_members where user_id = auth.uid()), 'owner', 'creator is owner');
select is((select (features ->> 'legal')::bool from workspaces where id = (select id from ids where name = 'ws_a')), true,
  'legal template turns on the legal pack');

insert into knowledge_bases (workspace_id, name, embedding_provider, embedding_model)
select id, 'Laws', 'mock', 'mock-1024' from ids where name = 'ws_a'
returning id as kb \gset
insert into ids values ('kb_a', :'kb');
insert into bots (workspace_id, name) select id, 'LegAI' from ids where name = 'ws_a' returning id as bot \gset
insert into ids values ('bot_a', :'bot');
insert into bot_knowledge_bases (bot_id, knowledge_base_id, workspace_id)
select :'bot', :'kb', id from ids where name = 'ws_a';
insert into sources (workspace_id, knowledge_base_id, kind, title, content, jurisdiction)
select id, :'kb', 'text', 'Employment Act', 'Notice periods...', 'MW' from ids where name = 'ws_a'
returning id as src \gset
insert into ids values ('src_a', :'src');

select pg_temp.login('00000000-0000-0000-0000-00000000000b', 'ben@example.com');
insert into ids values ('ws_b', create_workspace('Ben Shop'));

-- ── Isolation ──────────────────────────────────────────────────────────────
select is((select count(*)::int from workspaces), 1, 'Ben sees only his workspace');
select is((select count(*)::int from bots), 0, 'Ben sees no bots from Ada');
select is((select count(*)::int from sources), 0, 'Ben sees no sources from Ada');
select is((select count(*)::int from knowledge_bases), 0, 'Ben sees no knowledge bases from Ada');
select throws_ok(
  format($$insert into bots (workspace_id, name) values (%L, 'Sneaky')$$, (select id from ids where name = 'ws_a')),
  '42501', null, 'Ben cannot add a bot to Ada''s workspace');
update bots set name = 'Hacked' where id = (select id from ids where name = 'bot_a');
select pg_temp.logout();
select is((select name from bots where id = (select id from ids where name = 'bot_a')), 'LegAI',
  'Ben''s update to Ada''s bot changes nothing');

-- Ben cannot point his rows at Ada's parents (composite workspace keys).
select pg_temp.login('00000000-0000-0000-0000-00000000000b', 'ben@example.com');
insert into knowledge_bases (workspace_id, name) select id, 'Shop FAQ' from ids where name = 'ws_b' returning id as kb_b \gset
insert into bots (workspace_id, name) select id, 'Shop bot' from ids where name = 'ws_b';
select throws_ok(
  format($$insert into bots (workspace_id, name) values (%L, 'Second bot')$$, (select id from ids where name = 'ws_b')),
  'P0001', 'Your plan allows 1 bot(s). Upgrade to add more.', 'the free plan allows one bot');
select throws_ok(
  format($$insert into bot_knowledge_bases (bot_id, knowledge_base_id, workspace_id) values (%L, %L, %L)$$,
    (select id from ids where name = 'bot_a'), :'kb_b', (select id from ids where name = 'ws_b')),
  null, null, 'Ben cannot link Ada''s bot to his knowledge base');
insert into datasets (workspace_id, name) select id, 'Ben data' from ids where name = 'ws_b' returning id as ds_b \gset
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'ada@example.com');
select throws_ok(
  format($$insert into dataset_examples (workspace_id, dataset_id, messages) values (%L, %L, '[]')$$,
    (select id from ids where name = 'ws_a'), :'ds_b'),
  '23503', null, 'Ada cannot add examples to Ben''s dataset');

-- ── Roles ──────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'ada@example.com');
select create_invite((select id from ids where name = 'ws_a'), 'Ben@Example.com', 'reviewer') as invite_token \gset
select is((select count(*)::int from workspace_invites), 1, 'admin sees the pending invite');

select pg_temp.login('00000000-0000-0000-0000-00000000000c', 'cleo@example.com');
select throws_ok(format('select accept_invite(%L)', :'invite_token'), '42501', null,
  'an invite only works for the address it was sent to');

select pg_temp.login('00000000-0000-0000-0000-00000000000b', 'ben@example.com');
select is(accept_invite(:'invite_token'), (select id from ids where name = 'ws_a'), 'Ben accepts the invite');
select throws_ok(format('select accept_invite(%L)', :'invite_token'), 'P0002', null, 'an invite works once');
select is((select count(*)::int from workspaces), 2, 'Ben now sees both workspaces');
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'ada@example.com');
select throws_ok(
  format('select create_invite(%L, %L, %L)', (select id from ids where name = 'ws_a'), 'cleo@example.com', 'viewer'),
  'P0001', null, 'invites stop at the plan''s seat limit');
select pg_temp.login('00000000-0000-0000-0000-00000000000b', 'ben@example.com');
select is((select count(*)::int from bots where workspace_id = (select id from ids where name = 'ws_a')), 1,
  'reviewer can read Ada''s bots');
select throws_ok(
  format($$insert into bots (workspace_id, name) values (%L, 'Nope')$$, (select id from ids where name = 'ws_a')),
  '42501', null, 'reviewer cannot create bots');
select throws_ok(
  format($$select create_api_key(%L, 'k', 'secret')$$, (select id from ids where name = 'ws_a')),
  '42501', null, 'reviewer cannot create API keys');
update workspace_members set role = 'owner'
where workspace_id = (select id from ids where name = 'ws_a') and user_id = auth.uid();
select pg_temp.logout();
select is((select role from workspace_members where user_id = '00000000-0000-0000-0000-00000000000b'
  and workspace_id = (select id from ids where name = 'ws_a')), 'reviewer', 'Ben is still a reviewer');

-- ── API keys ───────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'ada@example.com');
select create_api_key((select id from ids where name = 'ws_a'), 'Widget', 'publishable',
  (select id from ids where name = 'bot_a')) as pk \gset
select ok(:'pk' like 'bd_pk_%', 'publishable key has the bd_pk_ prefix');
select create_api_key((select id from ids where name = 'ws_a'), 'Server', 'secret') as sk \gset
select ok(:'sk' like 'bd_sk_%', 'secret key has the bd_sk_ prefix');
select throws_ok('select key_hash from api_keys', '42501', null, 'key hashes are not readable');
select is((select scopes from api_keys where name = 'Widget'), array['chat'], 'publishable keys can only chat');
select pg_temp.logout();
select is((select count(*)::int from api_keys where key_hash = sha256_hex(:'sk')), 1, 'only the hash is stored');

-- ── Owners ─────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'ada@example.com');
select throws_ok(
  format($$delete from workspace_members where workspace_id = %L and user_id = auth.uid()$$,
    (select id from ids where name = 'ws_a')),
  'P0001', 'A workspace needs at least one owner.', 'the last owner cannot leave');
select throws_ok(
  format($$update workspaces set plan = 'enterprise' where id = %L$$, (select id from ids where name = 'ws_a')),
  '42501', null, 'members cannot change their plan');

-- ── Sources ────────────────────────────────────────────────────────────────
select pg_temp.logout();
select is((select count(*)::int from jobs where kind = 'ingest_source' and payload ->> 'source_id' = (select id from ids where name = 'src_a')::text),
  1, 'a new source is queued for indexing');
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'ada@example.com');
select throws_ok(
  format($$update sources set status = 'ready' where id = %L$$, (select id from ids where name = 'src_a')),
  '42501', null, 'users cannot mark a source ready');
select lives_ok(
  format($$update sources set status = 'disabled' where id = %L$$, (select id from ids where name = 'src_a')),
  'users can disable a source');
select lives_ok(
  format($$update sources set content = 'New text', status = 'disabled' where id = %L$$, (select id from ids where name = 'src_a')),
  'editing a disabled source keeps it disabled');
update sources set status = 'queued' where id = (select id from ids where name = 'src_a');
select pg_temp.logout();
select is((select count(*)::int from jobs where kind = 'ingest_source' and payload ->> 'source_id' = (select id from ids where name = 'src_a')::text),
  2, 're-queueing a source queues it again');

-- ── Storage paths ──────────────────────────────────────────────────────────
select is(storage_workspace((select id from ids where name = 'ws_a')::text || '/x/file.pdf'),
  (select id from ids where name = 'ws_a'), 'storage paths start with the workspace id');
select is(storage_workspace('not-a-uuid/file.pdf'), null, 'bad storage paths match no workspace');
select throws_ok(
  format($$insert into sources (workspace_id, knowledge_base_id, kind, title, storage_path) values (%L, %L, 'file', 'x', %L)$$,
    (select id from ids where name = 'ws_a'), (select id from ids where name = 'kb_a'),
    (select id from ids where name = 'ws_b')::text || '/00000000-0000-0000-0000-000000000001/x.pdf'),
  '23514', null, 'a source cannot point at another workspace''s file');
select throws_ok(
  format($$insert into sources (id, workspace_id, knowledge_base_id, kind, title, storage_path) values (%L, %L, %L, 'file', 'x', %L)$$,
    '00000000-0000-0000-0000-0000000000d1', (select id from ids where name = 'ws_a'), (select id from ids where name = 'kb_a'),
    (select id from ids where name = 'ws_a')::text || '/00000000-0000-0000-0000-0000000000d1/../../'
      || (select id from ids where name = 'ws_b')::text || '/s/secret.pdf'),
  '23514', null, 'a storage path cannot climb out of its folder');

-- ── Jobs ───────────────────────────────────────────────────────────────────
set local role service_role;
select is((select count(*)::int from claim_jobs('test', 10, array['ingest_source'])), 2, 'worker claims queued jobs');
select is((select count(*)::int from claim_jobs('test', 10, array['ingest_source'])), 0, 'claimed jobs are not handed out twice');
select is(fail_job((select min(id) from jobs where kind = 'ingest_source'), 'boom'), 'queued', 'a failed job is retried');
select is(hit_rate_limit('t', 2), true, 'rate limit: first hit allowed');
select is(hit_rate_limit('t', 2) and not hit_rate_limit('t', 2), true, 'rate limit: third hit blocked');
reset role;

-- ── Revocation, owners, deleting a workspace ───────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'ada@example.com');
update api_keys set revoked_at = now() where name = 'Widget';
select throws_ok($$update api_keys set revoked_at = null where name = 'Widget'$$, '42501', null, 'a revoked key cannot be restored');

select pg_temp.logout();
update workspace_members set role = 'admin'
where workspace_id = (select id from ids where name = 'ws_a') and user_id = '00000000-0000-0000-0000-00000000000b';
insert into workspace_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000000c', 'owner' from ids where name = 'ws_a';
select pg_temp.login('00000000-0000-0000-0000-00000000000b', 'ben@example.com');
update workspace_members set role = 'viewer'
where workspace_id = (select id from ids where name = 'ws_a') and user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.logout();
select is((select role from workspace_members where user_id = '00000000-0000-0000-0000-00000000000c'
  and workspace_id = (select id from ids where name = 'ws_a')), 'owner', 'an admin cannot demote an owner');

select pg_temp.login('00000000-0000-0000-0000-00000000000a', 'ada@example.com');
select lives_ok(
  format($$insert into sources (id, workspace_id, knowledge_base_id, kind, title, storage_path) values (%L, %L, %L, 'file', 'Report', %L)$$,
    '00000000-0000-0000-0000-0000000000d2', (select id from ids where name = 'ws_a'), (select id from ids where name = 'kb_a'),
    (select id from ids where name = 'ws_a')::text || '/00000000-0000-0000-0000-0000000000d2/report.pdf'),
  'a file source in its own folder is accepted');
select lives_ok(format($$delete from workspaces where id = %L$$, (select id from ids where name = 'ws_a')),
  'an owner can delete a workspace that has files');
select pg_temp.logout();
select is((select count(*)::int from jobs where kind = 'delete_file' and workspace_id is null
  and payload ->> 'path' like '%/report.pdf'), 1, 'its files are queued for deletion');

select * from finish();
rollback;
