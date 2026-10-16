-- ============================================================
-- BotDesk v2 — copy v1 data into the new tables
-- ============================================================
--   v1 account          -> workspace (the owner becomes its owner)
--   v1 app + settings   -> bot, plus a knowledge base for its entries
--   v1 kb_entries       -> Q&A sources (re-embedded by the worker)
--   v1 API keys         -> publishable keys (the same keys keep working)
--   v1 conversations    -> contacts, conversations, messages
-- Runs once; does nothing on a fresh database. The `legacy` schema is kept
-- so the copy can be checked. Drop it later with: drop schema legacy cascade;

do $$
begin
  if to_regclass('legacy.accounts') is null then
    return;
  end if;
  if exists (select 1 from public.workspaces) then
    raise notice 'Workspaces already exist; skipping the v1 import.';
    return;
  end if;

  -- Plan limits must not block the import.
  alter table public.bots disable trigger bots_limit;
  alter table public.sources disable trigger sources_limit;

  -- Workspaces
  insert into public.workspaces (id, name, slug, plan, created_by, created_at, settings)
  select a.id,
         coalesce(nullif(split_part(coalesce(a.display_name, ''), '@', 1), ''), 'My workspace'),
         left(coalesce(nullif(public.slugify(split_part(coalesce(a.display_name, ''), '@', 1)), ''), 'workspace'), 40)
           || '-' || substr(replace(a.id::text, '-', ''), 1, 6),
         case when a.plan in (select id from public.plans) then a.plan else 'free' end,
         a.owner_id, a.created_at,
         '{"retention_days": 365}'::jsonb
  from legacy.accounts a;

  insert into public.workspace_members (workspace_id, user_id, role)
  select a.id, a.owner_id, 'owner' from legacy.accounts a
  on conflict do nothing;

  -- Bots
  insert into public.bots (id, workspace_id, name, status, widget, answer_policy, handoff,
                           allowed_domains, rate_limit_per_min, created_by, created_at, updated_at)
  select p.id, p.account_id, left(p.name, 80),
         case when p.active then 'live' else 'paused' end,
         jsonb_build_object(
           'primary_color', p.primary_color,
           'position', case when p.position in ('bottom-left','bottom-right') then p.position else 'bottom-right' end,
           'title', p.bot_name,
           'welcome_message', p.welcome_message,
           'show_sources', true,
           'suggested_questions', '[]'::jsonb
         ),
         jsonb_build_object(
           'top_k', 6, 'min_score', 0.3, 'citations', 'optional', 'on_no_answer', 'handoff',
           'allow_general_knowledge', false, 'history_turns', 6,
           'fallback_message', s.out_of_scope_msg
         ),
         jsonb_strip_nulls(jsonb_build_object('enabled', true, 'email', s.escalation_email, 'phone', s.escalation_phone)),
         coalesce(s.allowed_domains, '{}'),
         greatest(1, least(coalesce(s.rate_limit_per_min, 12), 600)),
         a.owner_id, p.created_at, p.updated_at
  from legacy.apps p
  join legacy.accounts a on a.id = p.account_id
  left join legacy.app_settings s on s.app_id = p.id;

  -- One knowledge base per v1 app (its entries were per app).
  insert into public.knowledge_bases (id, workspace_id, name, description, created_at)
  select p.id, p.account_id, left(p.name || ' knowledge', 80), 'Imported from BotDesk v1', p.created_at
  from legacy.apps p
  where exists (select 1 from legacy.kb_entries k where k.app_id = p.id);

  insert into public.bot_knowledge_bases (bot_id, knowledge_base_id, workspace_id)
  select kb.id, kb.id, kb.workspace_id from public.knowledge_bases kb
  where exists (select 1 from public.bots b where b.id = kb.id);

  insert into public.sources (id, workspace_id, knowledge_base_id, kind, title, question, content,
                              status, metadata, created_at)
  select k.id, p.account_id, p.id, 'qa',
         left(coalesce(nullif(array_to_string(k.keywords, ', '), ''), left(k.answer, 80)), 200),
         nullif(array_to_string(k.keywords, ', '), ''),
         k.answer,
         case when k.active then 'queued' else 'disabled' end,
         jsonb_build_object('tags', to_jsonb(k.tags), 'imported_from', 'v1'),
         k.created_at
  from legacy.kb_entries k
  join legacy.apps p on p.id = k.app_id;

  -- API keys: same hash, so embedded v1 keys stay valid.
  insert into public.api_keys (workspace_id, bot_id, name, kind, prefix, key_hash, scopes, created_at,
                               last_used_at, revoked_at)
  select p.account_id, p.id, 'Imported v1 widget key', 'publishable', k.key_prefix, k.key_hash, '{chat}',
         k.created_at, k.last_used_at,
         case when k.active then null else coalesce(k.revoked_at, now()) end
  from legacy.app_api_keys k
  join legacy.apps p on p.id = k.app_id
  on conflict (key_hash) do nothing;

  -- Conversations
  insert into public.contacts (workspace_id, channel, external_id, name, email, created_at, last_seen_at)
  select distinct on (p.account_id, c.visitor_id)
         p.account_id, 'web', c.visitor_id, nullif(c.visitor_name, 'Visitor'), c.visitor_email,
         c.started_at, c.last_message
  from legacy.conversations c
  join legacy.apps p on p.id = c.app_id
  where c.deleted_at is null
  order by p.account_id, c.visitor_id, c.last_message desc
  on conflict do nothing;

  insert into public.conversations (id, workspace_id, bot_id, contact_id, channel, status, tags,
                                    last_message_at, created_at, handoff_at)
  select c.id, p.account_id, c.app_id, ct.id, 'web',
         case c.status when 'resolved' then 'resolved' when 'escalated' then 'handoff' else 'open' end,
         c.tags, c.last_message, c.started_at,
         case when c.escalated then c.last_message end
  from legacy.conversations c
  join legacy.apps p on p.id = c.app_id
  join public.contacts ct on ct.workspace_id = p.account_id and ct.channel = 'web' and ct.external_id = c.visitor_id
  where c.deleted_at is null;

  -- Bypass the per-message trigger; counters are set in one pass below.
  alter table public.messages disable trigger messages_after_insert;
  insert into public.messages (id, workspace_id, conversation_id, role, content, outcome, confidence, created_at)
  select m.id, cv.workspace_id, m.conversation_id,
         case m.role when 'bot' then 'assistant' when 'escalation' then 'system' else 'user' end,
         m.content,
         case when m.role = 'bot' then case when m.kb_entry_id is null then 'no_answer' else 'answered' end end,
         m.similarity, m.ts
  from legacy.messages m
  join public.conversations cv on cv.id = m.conversation_id;
  alter table public.messages enable trigger messages_after_insert;

  update public.conversations cv set
    message_count = s.n,
    title = s.first_question
  from (
    select conversation_id, count(*) as n,
           (array_agg(left(content, 120) order by created_at) filter (where role = 'user'))[1] as first_question
    from public.messages group by conversation_id
  ) s
  where s.conversation_id = cv.id;

  alter table public.bots enable trigger bots_limit;
  alter table public.sources enable trigger sources_limit;
end;
$$;
