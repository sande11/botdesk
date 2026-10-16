-- ============================================================
-- BotDesk v2 — contacts, conversations, messages, feedback
-- ============================================================

create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel      text not null check (channel in ('web','api','whatsapp','sms')),
  -- web: visitor id; api: the caller's user id; whatsapp/sms: phone number
  external_id  text not null,
  name         text,
  email        text,
  phone        text,
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (workspace_id, channel, external_id)
);

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  bot_id          uuid not null references public.bots(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  channel         text not null check (channel in ('web','api','whatsapp','sms')),
  -- open: the bot answers; handoff: waiting for / talking to a person
  status          text not null default 'open' check (status in ('open','handoff','resolved')),
  assigned_to     uuid references auth.users(id) on delete set null,
  -- For SMS/WhatsApp replies: which channel row received it.
  bot_channel_id  uuid references public.bot_channels(id) on delete set null,
  title           text,
  summary         text,
  tags            text[] not null default '{}',
  jurisdiction    text,
  metadata        jsonb not null default '{}',
  message_count   int not null default 0,
  unanswered      int not null default 0,       -- bot replies with no grounded answer
  last_message_at timestamptz not null default now(),
  handoff_at      timestamptz,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists conversations_ws_recent on public.conversations(workspace_id, last_message_at desc);
create index if not exists conversations_ws_status on public.conversations(workspace_id, status, last_message_at desc);
create index if not exists conversations_contact on public.conversations(bot_id, contact_id, last_message_at desc);
-- POST /v1/chat {conversation_ref}: one conversation per (bot, person, caller's thread id).
create unique index if not exists conversations_ref
  on public.conversations (bot_id, contact_id, (metadata ->> 'ref'))
  where metadata ? 'ref';

create table if not exists public.messages (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  conversation_id    uuid not null references public.conversations(id) on delete cascade,
  role               text not null check (role in ('user','assistant','agent','system')),
  content            text not null,
  -- [{"n": 1, "source_id", "chunk_id", "title", "url", "citation", "section", "snippet", "score"}]
  citations          jsonb not null default '[]',
  -- Legal pack answer: {"summary", "points": [], "sources": [{title, detail}], "follow_ups": []}
  structured         jsonb,
  -- answered | no_answer | handoff | error
  outcome            text check (outcome in ('answered','no_answer','handoff','error')),
  confidence         real,
  model              text,
  input_tokens       int,
  output_tokens      int,
  latency_ms         int,
  author_id          uuid references auth.users(id) on delete set null,
  channel_message_id text,
  delivery_status    text check (delivery_status in ('pending','sent','delivered','failed')),
  delivery_error     text,
  created_at         timestamptz not null default now()
);
create index if not exists messages_conversation on public.messages(conversation_id, created_at);
create index if not exists messages_ws_time on public.messages(workspace_id, created_at desc);
-- Webhooks can arrive twice; a provider message id is stored once.
create unique index if not exists messages_channel_dedupe
  on public.messages(workspace_id, channel_message_id) where channel_message_id is not null and role = 'user';

create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  message_id   uuid not null references public.messages(id) on delete cascade,
  rating       smallint not null check (rating in (-1, 1)),
  comment      text,
  origin       text not null default 'visitor' check (origin in ('visitor','agent','api')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists feedback_one_per_origin on public.feedback(message_id, origin);

-- ── Keep conversation counters current ─────────────────────────────────────

create or replace function public.on_message_inserted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  conv conversations%rowtype;
begin
  update conversations set
    message_count   = message_count + 1,
    last_message_at = new.created_at,
    unanswered      = unanswered + case when new.role = 'assistant' and new.outcome = 'no_answer' then 1 else 0 end,
    title           = coalesce(title, case when new.role = 'user' then left(new.content, 120) end),
    -- A person replying takes over the conversation.
    status          = case when new.role = 'agent' then 'handoff' else status end,
    assigned_to     = case when new.role = 'agent' then coalesce(assigned_to, new.author_id) else assigned_to end
  where id = new.conversation_id
  returning * into conv;

  -- Agent replies to WhatsApp/SMS are sent by the worker.
  if new.role = 'agent' and conv.channel in ('whatsapp','sms') then
    perform enqueue_job(new.workspace_id, 'deliver_message', jsonb_build_object('message_id', new.id), '0 seconds', 10);
  end if;
  return new;
end;
$$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.on_message_inserted();

create or replace function public.on_conversation_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'handoff' and old.status is distinct from 'handoff' then
    new.handoff_at := now();
  end if;
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists conversations_status on public.conversations;
create trigger conversations_status before update of status on public.conversations
  for each row execute function public.on_conversation_status();

create or replace function public.notify_on_handoff()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'handoff' and old.status is distinct from 'handoff' then
    perform enqueue_job(new.workspace_id, 'notify_handoff', jsonb_build_object('conversation_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists conversations_notify on public.conversations;
create trigger conversations_notify after update of status on public.conversations
  for each row execute function public.notify_on_handoff();

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.contacts      enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.feedback      enable row level security;

drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts for select to authenticated
  using (workspace_id in (select public.my_workspaces('reviewer')));
drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
  using (workspace_id in (select public.my_workspaces('reviewer')))
  with check (workspace_id in (select public.my_workspaces('reviewer')));
drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts for delete to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));
revoke update on public.contacts from authenticated;
grant update (name, email, phone, metadata) on public.contacts to authenticated;

drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update to authenticated
  using (workspace_id in (select public.my_workspaces('reviewer')))
  with check (workspace_id in (select public.my_workspaces('reviewer')));
drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations for delete to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));
revoke update on public.conversations from authenticated;
grant update (status, assigned_to, tags, title) on public.conversations to authenticated;

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
-- People reply from the inbox as role 'agent'.
drop policy if exists messages_agent_reply on public.messages;
create policy messages_agent_reply on public.messages for insert to authenticated
  with check (
    workspace_id in (select public.my_workspaces('reviewer'))
    and role in ('agent', 'system')
    and author_id = auth.uid()
    and exists (select 1 from public.conversations c
                where c.id = conversation_id and c.workspace_id = messages.workspace_id)
  );
revoke update, delete on public.messages from authenticated;

drop policy if exists feedback_read on public.feedback;
create policy feedback_read on public.feedback for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists feedback_write on public.feedback;
create policy feedback_write on public.feedback for insert to authenticated
  with check (workspace_id in (select public.my_workspaces('reviewer')) and origin = 'agent' and created_by = auth.uid());

-- ── Realtime for the inbox ─────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversations') then
      alter publication supabase_realtime add table public.conversations;
    end if;
  end if;
end;
$$;
