-- ============================================================
-- BotDesk v2 — bots, channels, API keys, model provider keys
-- ============================================================

-- ── Model provider keys (stored in Supabase Vault) ─────────────────────────
-- A workspace can bring its own keys. When it has none for a provider, the
-- platform's keys are used if its plan allows (plans.limits.platform_ai).

create table if not exists public.provider_credentials (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider     text not null check (provider in ('anthropic','openai','voyage','together','openai_compatible')),
  label        text not null default 'default',
  base_url     text,
  secret_id    uuid not null,              -- vault.secrets.id
  key_hint     text,                       -- last 4 characters, for display
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, provider, label)
);

-- Custom models: fine-tuned results or models behind an OpenAI-compatible
-- endpoint (Together, Fireworks, vLLM, OpenRouter...). Built-in models are
-- listed in code (supabase/functions/_shared/ai/catalog.ts).
create table if not exists public.custom_models (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  provider       text not null check (provider in ('openai','together','openai_compatible')),
  model          text not null,
  label          text not null,
  credential_id  uuid references public.provider_credentials(id) on delete set null,
  origin         text not null default 'custom' check (origin in ('custom','finetune')),
  finetune_job_id uuid,
  created_at     timestamptz not null default now(),
  unique (workspace_id, provider, model)
);

-- ── Bots ───────────────────────────────────────────────────────────────────

create table if not exists public.bots (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  name             text not null check (length(name) between 1 and 80),
  description      text not null default '',
  status           text not null default 'live' check (status in ('draft','live','paused')),
  -- Extra instructions for tone and scope, added to the system prompt.
  instructions     text not null default '',
  -- {"provider": "anthropic", "model": "claude-haiku-5-5", "max_tokens": 800,
  --  "custom_model_id": null, "temperature": null}
  model            jsonb not null default '{"provider": "anthropic", "model": "claude-haiku-5-5", "max_tokens": 800}',
  -- {"top_k": 6, "min_score": 0.3, "citations": "required"|"optional"|"off",
  --  "on_no_answer": "handoff"|"message", "fallback_message": "...",
  --  "allow_general_knowledge": false, "history_turns": 6}
  answer_policy    jsonb not null default '{"top_k": 6, "min_score": 0.3, "citations": "required", "on_no_answer": "handoff", "allow_general_knowledge": false, "history_turns": 6}',
  -- Legal pack: {"enabled": true, "answer_format": "legal", "default_jurisdiction": "MW",
  --  "disclaimer": "...", "review_low_confidence": true}
  legal            jsonb not null default '{}',
  -- {"enabled": true, "email": "...", "message": "..."}
  handoff          jsonb not null default '{"enabled": true}',
  -- Web widget look: primary_color, position, title, subtitle, welcome_message,
  -- launcher_label, suggested_questions[], show_sources, avatar_url
  widget           jsonb not null default '{"primary_color": "#6d5df5", "position": "bottom-right", "title": "Ask us anything", "welcome_message": "Hi! How can I help you today?", "show_sources": true, "suggested_questions": []}',
  allowed_domains  text[] not null default '{}',
  rate_limit_per_min int not null default 12 check (rate_limit_per_min between 1 and 600),
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists bots_workspace on public.bots(workspace_id);

drop trigger if exists bots_updated_at on public.bots;
create trigger bots_updated_at before update on public.bots
  for each row execute function public.touch_updated_at();

-- ── Channels ───────────────────────────────────────────────────────────────
-- web and api need no setup. WhatsApp and SMS channels keep their provider
-- tokens in Vault (secret_id); `config` holds only non-secret settings.

create table if not exists public.bot_channels (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  bot_id        uuid not null references public.bots(id) on delete cascade,
  kind          text not null check (kind in ('whatsapp','twilio_sms','africastalking_sms')),
  name          text not null default '',
  status        text not null default 'active' check (status in ('active','disabled')),
  -- whatsapp: phone_number_id, display_phone_number, graph_version
  -- twilio_sms: account_sid, from_number
  -- africastalking_sms: username, from (short code / sender id), sandbox
  config        jsonb not null default '{}',
  secret_id     uuid,                      -- vault: {"access_token"...} / {"auth_token"} / {"api_key"}
  -- Unguessable id in the webhook URL: /functions/v1/channels/<kind>/<webhook_token>
  webhook_token text not null unique default public.random_token(18),
  -- WhatsApp's GET verification handshake
  verify_token  text not null default public.random_token(12),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists bot_channels_bot on public.bot_channels(bot_id);

drop trigger if exists bot_channels_updated_at on public.bot_channels;
create trigger bot_channels_updated_at before update on public.bot_channels
  for each row execute function public.touch_updated_at();

-- ── API keys ───────────────────────────────────────────────────────────────
--   publishable  bd_pk_...  safe in a web page; widget chat only, checked
--                            against the bot's allowed domains
--   secret       bd_sk_...  server-to-server and mobile backends; can chat as
--                            any contact, ingest documents, read conversations

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bot_id       uuid references public.bots(id) on delete cascade,   -- null: every bot
  name         text not null default '',
  kind         text not null check (kind in ('publishable','secret')),
  prefix       text not null,
  key_hash     text not null unique,
  -- Publishable keys are public by design (they sit in web pages), so the
  -- dashboard can show them again. Secret keys are only ever stored hashed.
  display_key  text,
  scopes       text[] not null default '{chat}',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz
);
create index if not exists api_keys_workspace on public.api_keys(workspace_id);

-- Returns the raw key once. Scopes: chat, ingest, conversations, analyze.
create or replace function public.create_api_key(
  p_workspace uuid,
  p_name      text,
  p_kind      text default 'publishable',
  p_bot       uuid default null,
  p_scopes    text[] default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  raw    text;
  scopes text[];
begin
  if not has_role(p_workspace, 'admin') then
    raise exception 'Only admins can create API keys.' using errcode = '42501';
  end if;
  if p_kind not in ('publishable','secret') then
    raise exception 'Unknown key kind %', p_kind using errcode = '22023';
  end if;
  if p_bot is not null and not exists (select 1 from bots where id = p_bot and workspace_id = p_workspace) then
    raise exception 'That bot is not in this workspace.' using errcode = '22023';
  end if;

  scopes := case
    when p_kind = 'publishable' then array['chat']
    else coalesce(p_scopes, array['chat','ingest','conversations','analyze'])
  end;
  if exists (select 1 from unnest(scopes) s where s not in ('chat','ingest','conversations','analyze')) then
    raise exception 'Unknown scope in %', scopes using errcode = '22023';
  end if;

  raw := case when p_kind = 'publishable' then 'bd_pk_' else 'bd_sk_' end
         || replace(replace(random_token(24), '-', 'x'), '_', 'y');

  insert into api_keys (workspace_id, bot_id, name, kind, prefix, key_hash, display_key, scopes, created_by)
  values (p_workspace, p_bot, coalesce(p_name, ''), p_kind, left(raw, 12), sha256_hex(raw),
          case when p_kind = 'publishable' then raw end, scopes, auth.uid());

  perform audit(p_workspace, 'api_key.created', 'api_key', left(raw, 12), jsonb_build_object('kind', p_kind, 'bot', p_bot));
  return raw;
end;
$$;

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.provider_credentials enable row level security;
alter table public.custom_models        enable row level security;
alter table public.bots                 enable row level security;
alter table public.bot_channels         enable row level security;
alter table public.api_keys             enable row level security;

-- Provider keys: admins see labels and hints; secrets are written by the
-- admin Edge Function into Vault.
drop policy if exists provider_credentials_read on public.provider_credentials;
create policy provider_credentials_read on public.provider_credentials for select to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));
drop policy if exists provider_credentials_delete on public.provider_credentials;
create policy provider_credentials_delete on public.provider_credentials for delete to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));

drop policy if exists custom_models_read on public.custom_models;
create policy custom_models_read on public.custom_models for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists custom_models_write on public.custom_models;
create policy custom_models_write on public.custom_models for all to authenticated
  using (workspace_id in (select public.my_workspaces('editor')))
  with check (workspace_id in (select public.my_workspaces('editor')));

drop policy if exists bots_read on public.bots;
create policy bots_read on public.bots for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists bots_write on public.bots;
create policy bots_write on public.bots for all to authenticated
  using (workspace_id in (select public.my_workspaces('editor')))
  with check (workspace_id in (select public.my_workspaces('editor')));

drop policy if exists bot_channels_read on public.bot_channels;
create policy bot_channels_read on public.bot_channels for select to authenticated
  using (workspace_id in (select public.my_workspaces('editor')));
drop policy if exists bot_channels_update on public.bot_channels;
create policy bot_channels_update on public.bot_channels for update to authenticated
  using (workspace_id in (select public.my_workspaces('admin')))
  with check (workspace_id in (select public.my_workspaces('admin')));
drop policy if exists bot_channels_delete on public.bot_channels;
create policy bot_channels_delete on public.bot_channels for delete to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));
revoke update on public.bot_channels from authenticated;
grant update (name, status, config) on public.bot_channels to authenticated;

drop policy if exists api_keys_read on public.api_keys;
create policy api_keys_read on public.api_keys for select to authenticated
  using (workspace_id in (select public.my_workspaces('admin')));
drop policy if exists api_keys_revoke on public.api_keys;
create policy api_keys_revoke on public.api_keys for update to authenticated
  using (workspace_id in (select public.my_workspaces('admin')))
  with check (workspace_id in (select public.my_workspaces('admin')));
revoke update on public.api_keys from authenticated;
grant update (name, revoked_at) on public.api_keys to authenticated;
-- Keys are created only by create_api_key(); key_hash is never readable.
revoke select on public.api_keys from anon, authenticated;
grant select (id, workspace_id, bot_id, name, kind, prefix, display_key, scopes, created_by,
              created_at, last_used_at, expires_at, revoked_at)
  on public.api_keys to authenticated;

-- ── Bot limit per plan ─────────────────────────────────────────────────────

create or replace function public.plan_limit(p_workspace uuid, p_key text)
returns int language sql stable security definer set search_path = public as $$
  select (p.limits ->> p_key)::int
  from workspaces w join plans p on p.id = w.plan
  where w.id = p_workspace
$$;

-- SECURITY INVOKER on purpose: current_user tells a direct API insert
-- ('authenticated') from one made inside a SECURITY DEFINER function.
create or replace function public.enforce_bot_limit()
returns trigger language plpgsql set search_path = public as $$
declare
  lim int := plan_limit(new.workspace_id, 'bots');
begin
  -- Triggers run before RLS checks; don't reveal plan details to outsiders.
  -- (current_user is the function owner inside SECURITY DEFINER functions,
  -- which do their own checks.)
  if current_user = 'authenticated' and not has_role(new.workspace_id, 'editor') then
    raise exception 'permission denied for table bots' using errcode = '42501';
  end if;
  if lim is not null and (select count(*) from bots where workspace_id = new.workspace_id) >= lim then
    raise exception 'Your plan allows % bot(s). Upgrade to add more.', lim using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists bots_limit on public.bots;
create trigger bots_limit before insert on public.bots
  for each row execute function public.enforce_bot_limit();
