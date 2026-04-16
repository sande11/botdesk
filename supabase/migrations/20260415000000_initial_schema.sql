-- ============================================================
-- BotDesk — Initial Schema (idempotent)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan         text NOT NULL DEFAULT 'free',
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name            text NOT NULL,
  url             text NOT NULL DEFAULT '',
  primary_color   text NOT NULL DEFAULT '#7c6df8',
  bot_name        text NOT NULL DEFAULT 'Assistant',
  welcome_message text NOT NULL DEFAULT 'Hi! How can I help you today?',
  position        text NOT NULL DEFAULT 'bottom-right',
  language        text NOT NULL DEFAULT 'en',
  active          bool NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apps_account ON apps(account_id);

CREATE TABLE IF NOT EXISTS app_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id       uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  key_prefix   text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  active       bool NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON app_api_keys(key_hash) WHERE active = true;

CREATE TABLE IF NOT EXISTS app_settings (
  app_id             uuid PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  out_of_scope_msg   text NOT NULL DEFAULT 'I''m not sure about that. Let me connect you with a team member.',
  escalation_email   text,
  escalation_phone   text,
  rate_limit_per_min int NOT NULL DEFAULT 10,
  rate_limit_per_day int NOT NULL DEFAULT 200,
  allowed_domains    text[] NOT NULL DEFAULT '{}',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  keywords    text[] NOT NULL DEFAULT '{}',
  answer      text NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',
  active      bool NOT NULL DEFAULT true,
  embedding   vector(1536),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kb_entries_app ON kb_entries(app_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_kb_entries_embedding ON kb_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  visitor_id    text NOT NULL,
  visitor_name  text NOT NULL DEFAULT 'Visitor',
  visitor_email text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','escalated')),
  channel       text NOT NULL DEFAULT 'web',
  escalated     bool NOT NULL DEFAULT false,
  tags          text[] NOT NULL DEFAULT '{}',
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_message  timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_conversations_app_last   ON conversations(app_id, last_message DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_app_status ON conversations(app_id, status)            WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','bot','escalation')),
  content         text NOT NULL,
  kb_entry_id     uuid REFERENCES kb_entries(id) ON DELETE SET NULL,
  similarity      float4,
  ts              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, ts ASC);

CREATE TABLE IF NOT EXISTS escalations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('email','whatsapp')),
  recipient       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  provider_ref    text,
  sent_at         timestamptz,
  error           text,
  retry_count     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escalations_pending ON escalations(status, created_at) WHERE status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS rate_limits (
  app_id        uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  visitor_id    text NOT NULL,
  minute_bucket bigint NOT NULL,
  count         int NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, visitor_id, minute_bucket)
);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apps_updated_at ON apps;
CREATE TRIGGER apps_updated_at
  BEFORE UPDATE ON apps
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS kb_entries_updated_at ON kb_entries;
CREATE TRIGGER kb_entries_updated_at
  BEFORE UPDATE ON kb_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE FUNCTION bump_conversation_last_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations SET last_message = NEW.ts WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_bump_last ON messages;
CREATE TRIGGER messages_bump_last
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION bump_conversation_last_message();

-- ============================================================
-- RATE LIMIT FUNCTION (atomic increment)
-- ============================================================

CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_app_id        uuid,
  p_visitor_id    text,
  p_minute_bucket bigint
)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  new_count int;
BEGIN
  INSERT INTO rate_limits (app_id, visitor_id, minute_bucket, count)
  VALUES (p_app_id, p_visitor_id, p_minute_bucket, 1)
  ON CONFLICT (app_id, visitor_id, minute_bucket)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

-- ============================================================
-- VECTOR SEARCH FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION match_kb_entries(
  p_app_id    uuid,
  p_embedding vector(1536),
  p_threshold float4 DEFAULT 0.70,
  p_limit     int    DEFAULT 3
)
RETURNS TABLE (id uuid, answer text, similarity float4)
LANGUAGE sql STABLE AS $$
  SELECT
    kb.id,
    kb.answer,
    1 - (kb.embedding <=> p_embedding) AS similarity
  FROM kb_entries kb
  WHERE
    kb.app_id = p_app_id
    AND kb.active = true
    AND kb.embedding IS NOT NULL
    AND 1 - (kb.embedding <=> p_embedding) >= p_threshold
  ORDER BY kb.embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- ============================================================
-- pg_cron (optional — only runs if extension is enabled)
-- Enable in: Supabase Dashboard → Database → Extensions → pg_cron
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-rate-limits',
      '0 * * * *',
      $cron$
        DELETE FROM rate_limits
        WHERE minute_bucket < EXTRACT(EPOCH FROM now() - INTERVAL '2 hours')::bigint / 60;
      $cron$
    );
    PERFORM cron.schedule(
      'retry-escalations',
      '*/5 * * * *',
      $cron$
        UPDATE escalations SET status = 'pending'
        WHERE status = 'failed' AND retry_count < 3
          AND created_at < now() - INTERVAL '5 minutes';
      $cron$
    );
  END IF;
END;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE apps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_api_keys  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits   ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION auth_account_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM accounts WHERE owner_id = auth.uid() LIMIT 1;
$$;

DO $$
BEGIN
  -- accounts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='accounts' AND policyname='accounts_self') THEN
    CREATE POLICY accounts_self ON accounts FOR ALL USING (owner_id = auth.uid());
  END IF;
  -- apps
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='apps' AND policyname='apps_owner') THEN
    CREATE POLICY apps_owner ON apps FOR ALL USING (account_id = auth_account_id());
  END IF;
  -- app_api_keys
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_api_keys' AND policyname='api_keys_owner') THEN
    CREATE POLICY api_keys_owner ON app_api_keys FOR ALL
      USING (app_id IN (SELECT id FROM apps WHERE account_id = auth_account_id()));
  END IF;
  -- app_settings
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_settings' AND policyname='app_settings_owner') THEN
    CREATE POLICY app_settings_owner ON app_settings FOR ALL
      USING (app_id IN (SELECT id FROM apps WHERE account_id = auth_account_id()));
  END IF;
  -- kb_entries
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='kb_entries' AND policyname='kb_entries_owner') THEN
    CREATE POLICY kb_entries_owner ON kb_entries FOR ALL
      USING (app_id IN (SELECT id FROM apps WHERE account_id = auth_account_id()));
  END IF;
  -- conversations
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='conversations' AND policyname='conversations_owner') THEN
    CREATE POLICY conversations_owner ON conversations FOR ALL
      USING (app_id IN (SELECT id FROM apps WHERE account_id = auth_account_id()));
  END IF;
  -- messages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='messages' AND policyname='messages_owner') THEN
    CREATE POLICY messages_owner ON messages FOR ALL
      USING (
        conversation_id IN (
          SELECT id FROM conversations
          WHERE app_id IN (SELECT id FROM apps WHERE account_id = auth_account_id())
        )
      );
  END IF;
  -- escalations
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='escalations' AND policyname='escalations_owner') THEN
    CREATE POLICY escalations_owner ON escalations FOR ALL
      USING (
        conversation_id IN (
          SELECT id FROM conversations
          WHERE app_id IN (SELECT id FROM apps WHERE account_id = auth_account_id())
        )
      );
  END IF;
  -- rate_limits: service role only
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rate_limits' AND policyname='rate_limits_deny_anon') THEN
    CREATE POLICY rate_limits_deny_anon ON rate_limits FOR ALL USING (false);
  END IF;
END;
$$;

-- ============================================================
-- Auto-create account row on sign-up
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.accounts (owner_id, display_name)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
