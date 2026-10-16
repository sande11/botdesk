-- ============================================================
-- BotDesk v2 — knowledge bases, sources, chunks, hybrid search
-- ============================================================
-- A knowledge base holds sources (files, web pages, pasted text, Q&A).
-- The worker splits each source into chunks and embeds them. Answers are
-- grounded in chunks found by hybrid search: vector similarity and
-- full-text rank, merged with reciprocal rank fusion.
--
-- All embeddings are 1024-dimensional so one index serves every tenant:
-- voyage-law-2 / voyage-4 are 1024 natively; OpenAI text-embedding-3-* are
-- requested at 1024 dimensions. A knowledge base keeps its embedding model;
-- changing it re-embeds every chunk.

create table if not exists public.knowledge_bases (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  name               text not null check (length(name) between 1 and 80),
  description        text not null default '',
  embedding_provider text not null default 'openai' check (embedding_provider in ('openai','voyage','mock')),
  embedding_model    text not null default 'text-embedding-3-small',
  chunk_tokens       int  not null default 450 check (chunk_tokens between 100 and 2000),
  chunk_overlap      int  not null default 60  check (chunk_overlap between 0 and 400),
  -- Show legal fields (jurisdiction, citation, ...) on its sources.
  legal              bool not null default false,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists knowledge_bases_ws on public.knowledge_bases(workspace_id);

drop trigger if exists knowledge_bases_updated_at on public.knowledge_bases;
create trigger knowledge_bases_updated_at before update on public.knowledge_bases
  for each row execute function public.touch_updated_at();

create table if not exists public.bot_knowledge_bases (
  bot_id            uuid not null references public.bots(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  primary key (bot_id, knowledge_base_id)
);

create or replace function public.check_same_workspace_bot_kb()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from bots where id = new.bot_id and workspace_id = new.workspace_id)
     or not exists (select 1 from knowledge_bases where id = new.knowledge_base_id and workspace_id = new.workspace_id) then
    raise exception 'Bot and knowledge base must be in the same workspace.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists bot_kb_same_ws on public.bot_knowledge_bases;
create trigger bot_kb_same_ws before insert or update on public.bot_knowledge_bases
  for each row execute function public.check_same_workspace_bot_kb();

-- ── Sources ────────────────────────────────────────────────────────────────

create table if not exists public.sources (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  parent_id         uuid references public.sources(id) on delete cascade,  -- pages found from a sitemap
  kind              text not null check (kind in ('file','url','sitemap','text','qa')),
  title             text not null default '',
  url               text,
  storage_path      text,                 -- bucket "sources": <workspace>/<source>/<file name>
  mime_type         text,
  bytes             bigint,
  content           text,                 -- text/qa: the text; qa: the answer
  question          text,                 -- qa only
  status            text not null default 'queued'
                    check (status in ('queued','processing','ready','failed','disabled')),
  error             text,
  checksum          text,
  token_count       int not null default 0,
  chunk_count       int not null default 0,
  progress          jsonb not null default '{}',
  -- Legal pack fields (any workspace may use them for filtering)
  jurisdiction      text,                 -- ISO country / region, e.g. MW, KE, ZA-GP
  source_type       text check (source_type in
                      ('statute','regulation','case_law','constitution','guidance','practice_note',
                       'form','faq','verified_answer','other')),
  citation          text,                 -- e.g. "Employment Act (Cap. 55:01)"
  effective_date    date,
  superseded        bool not null default false,
  metadata          jsonb not null default '{}',
  refresh_hours     int check (refresh_hours is null or refresh_hours >= 1),
  last_indexed_at   timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- The worker reads files with the service role, so a source may only
  -- point at one file directly inside its own workspace/source folder
  -- (no "..", no sub-folders).
  constraint sources_storage_path_own check (
    storage_path is null
    or storage_path ~ ('^' || workspace_id::text || '/' || id::text || '/[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$')
  )
);
create index if not exists sources_kb on public.sources(knowledge_base_id, created_at desc);
create index if not exists sources_ws on public.sources(workspace_id);
create index if not exists sources_refresh on public.sources(last_indexed_at) where refresh_hours is not null;

drop trigger if exists sources_updated_at on public.sources;
create trigger sources_updated_at before update on public.sources
  for each row execute function public.touch_updated_at();

-- Raw text extracted page by page from large files, so extraction can
-- resume across worker runs.
create table if not exists public.source_parts (
  source_id uuid not null references public.sources(id) on delete cascade,
  part      int  not null,
  text      text not null,
  primary key (source_id, part)
);

-- ── Chunks ─────────────────────────────────────────────────────────────────

create table if not exists public.chunks (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  source_id         uuid not null references public.sources(id) on delete cascade,
  ordinal           int  not null,
  content           text not null,
  heading           text not null default '',   -- "Part III › Section 42"
  section           text,                       -- e.g. "s. 42", for citations
  token_count       int  not null default 0,
  embedding         vector(1024),
  fts               tsvector generated always as (
                      to_tsvector('english', coalesce(heading, '') || ' ' || content)
                    ) stored,
  created_at        timestamptz not null default now()
);
create index if not exists chunks_source on public.chunks(source_id, ordinal);
create index if not exists chunks_kb on public.chunks(knowledge_base_id);
create index if not exists chunks_fts on public.chunks using gin(fts);
create index if not exists chunks_embedding on public.chunks
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- ── Source limit per plan, and indexing on create ──────────────────────────

-- SECURITY INVOKER on purpose: current_user tells a direct API insert
-- ('authenticated') from one made inside a SECURITY DEFINER function.
create or replace function public.enforce_source_limit()
returns trigger language plpgsql set search_path = public as $$
declare
  lim int := plan_limit(new.workspace_id, 'sources');
begin
  if current_user = 'authenticated' and not has_role(new.workspace_id, 'editor') then
    raise exception 'permission denied for table sources' using errcode = '42501';
  end if;
  if new.parent_id is null and lim is not null
     and (select count(*) from sources where workspace_id = new.workspace_id and parent_id is null) >= lim then
    raise exception 'Your plan allows % sources. Upgrade to add more.', lim using errcode = 'P0001';
  end if;
  if not exists (select 1 from knowledge_bases where id = new.knowledge_base_id and workspace_id = new.workspace_id) then
    raise exception 'Knowledge base is not in this workspace.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists sources_limit on public.sources;
create trigger sources_limit before insert on public.sources
  for each row execute function public.enforce_source_limit();

create or replace function public.queue_source_indexing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'queued' and (tg_op = 'INSERT' or old.status is distinct from 'queued') then
    perform enqueue_job(new.workspace_id, 'ingest_source', jsonb_build_object('source_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists sources_queue on public.sources;
-- Plain AFTER UPDATE: status may be changed by the BEFORE trigger below,
-- which `update of status` would not notice.
create trigger sources_queue after insert or update on public.sources
  for each row execute function public.queue_source_indexing();

-- Dashboard users may re-index (queued) or disable a source; the worker
-- sets every other status.
create or replace function public.guard_source_status()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(auth.role(), '') = 'authenticated'
     and new.status not in ('queued', 'disabled') then
    raise exception 'A source can only be re-indexed or disabled.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists sources_status_guard on public.sources;
create trigger sources_status_guard before update of status on public.sources
  for each row execute function public.guard_source_status();

-- Re-index when the text of a pasted source changes.
create or replace function public.requeue_changed_source()
returns trigger language plpgsql as $$
begin
  if new.kind in ('text','qa')
     and (new.content is distinct from old.content or new.question is distinct from old.question)
     and new.status <> 'disabled' then
    new.status := 'queued';
  end if;
  return new;
end;
$$;
drop trigger if exists sources_requeue on public.sources;
create trigger sources_requeue before update of content, question on public.sources
  for each row execute function public.requeue_changed_source();

-- Changing a knowledge base's embedding model re-indexes all its sources.
create or replace function public.reembed_knowledge_base()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.embedding_model is distinct from old.embedding_model
     or new.embedding_provider is distinct from old.embedding_provider
     or new.chunk_tokens is distinct from old.chunk_tokens
     or new.chunk_overlap is distinct from old.chunk_overlap then
    update sources set status = 'queued', checksum = null
    where knowledge_base_id = new.id and status <> 'disabled' and kind <> 'sitemap';
  end if;
  return new;
end;
$$;
drop trigger if exists knowledge_bases_reembed on public.knowledge_bases;
create trigger knowledge_bases_reembed after update on public.knowledge_bases
  for each row execute function public.reembed_knowledge_base();

-- ── Hybrid search ──────────────────────────────────────────────────────────
-- p_filter: {"jurisdiction": "MW", "source_types": ["statute"],
--            "include_superseded": false, "source_ids": [...]}
-- Runs with the caller's rights, so RLS applies for dashboard users.

create or replace function public.match_chunks(
  p_kb_ids    uuid[],
  p_embedding vector(1024),
  p_query     text,
  p_count     int default 8,
  p_filter    jsonb default '{}'
)
returns table (
  chunk_id      uuid,
  source_id     uuid,
  knowledge_base_id uuid,
  content       text,
  heading       text,
  section       text,
  title         text,
  url           text,
  citation      text,
  jurisdiction  text,
  source_type   text,
  vector_score  float8,
  text_score    float8,
  score         float8
)
language plpgsql stable set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_k          int := least(greatest(coalesce(p_count, 8), 1), 50);
  v_pool       int := least(v_k * 5, 100);
  v_jur        text := nullif(p_filter ->> 'jurisdiction', '');
  v_types      text[] := (select array_agg(x) from jsonb_array_elements_text(coalesce(p_filter -> 'source_types', '[]')) x);
  v_sources    uuid[] := (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_filter -> 'source_ids', '[]')) x);
  v_superseded bool := coalesce((p_filter ->> 'include_superseded')::bool, false);
  -- Any of the question's words (stemmed, stop words dropped), not all of them.
  v_tsq        tsquery := (
    select to_tsquery('simple', string_agg(quote_literal(lex), ' | '))
    from unnest(tsvector_to_array(to_tsvector('english', left(coalesce(p_query, ''), 2000)))) lex
  );
begin
  -- Keep scanning the HNSW index until enough rows pass the filters.
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', greatest(v_pool, 40)::text, true);

  return query
  with eligible as (
    select s.id, s.title, s.url, s.citation, s.jurisdiction, s.source_type
    from sources s
    where s.knowledge_base_id = any(p_kb_ids)
      and s.status = 'ready'
      and (v_superseded or not s.superseded)
      -- Sources without a jurisdiction apply everywhere.
      and (v_jur is null or s.jurisdiction is null or s.jurisdiction = v_jur or s.jurisdiction like v_jur || '-%')
      and (v_types is null or s.source_type = any(v_types))
      and (v_sources is null or s.id = any(v_sources))
  ),
  semantic as (
    select v.id, 1 - v.dist as sim, row_number() over (order by v.dist) as rnk
    from (
      -- Plain ORDER BY distance LIMIT so the HNSW index is used.
      select c.id, c.embedding <=> p_embedding as dist
      from chunks c
      where p_embedding is not null
        and c.knowledge_base_id = any(p_kb_ids)
        and c.embedding is not null
        and c.source_id in (select id from eligible)
      order by c.embedding <=> p_embedding
      limit v_pool
    ) v
  ),
  lexical as (
    select v.id, v.rank_score, row_number() over (order by v.rank_score desc) as rnk
    from (
      select c.id, ts_rank_cd(c.fts, v_tsq) as rank_score
      from chunks c
      where v_tsq is not null
        and c.knowledge_base_id = any(p_kb_ids)
        and c.fts @@ v_tsq
        and c.source_id in (select id from eligible)
      order by 2 desc
      limit v_pool
    ) v
  ),
  fused as (
    select coalesce(se.id, le.id) as id,
           se.sim, le.rank_score,
           coalesce(1.0 / (60 + se.rnk), 0) + coalesce(1.0 / (60 + le.rnk), 0) as rrf
    from semantic se
    full outer join lexical le on le.id = se.id
  )
  select c.id, c.source_id, c.knowledge_base_id, c.content, c.heading, c.section,
         e.title, e.url, e.citation, e.jurisdiction, e.source_type,
         f.sim::float8, f.rank_score::float8, f.rrf::float8
  from fused f
  join chunks c on c.id = f.id
  join eligible e on e.id = c.source_id
  order by f.rrf desc
  limit v_k;
end;
$$;

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.knowledge_bases     enable row level security;
alter table public.bot_knowledge_bases enable row level security;
alter table public.sources             enable row level security;
alter table public.source_parts        enable row level security;   -- service role only
alter table public.chunks              enable row level security;

drop policy if exists kb_read on public.knowledge_bases;
create policy kb_read on public.knowledge_bases for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists kb_write on public.knowledge_bases;
create policy kb_write on public.knowledge_bases for all to authenticated
  using (workspace_id in (select public.my_workspaces('editor')))
  with check (workspace_id in (select public.my_workspaces('editor')));

drop policy if exists bot_kb_read on public.bot_knowledge_bases;
create policy bot_kb_read on public.bot_knowledge_bases for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists bot_kb_write on public.bot_knowledge_bases;
create policy bot_kb_write on public.bot_knowledge_bases for all to authenticated
  using (workspace_id in (select public.my_workspaces('editor')))
  with check (workspace_id in (select public.my_workspaces('editor')));

drop policy if exists sources_read on public.sources;
create policy sources_read on public.sources for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
drop policy if exists sources_write on public.sources;
create policy sources_write on public.sources for all to authenticated
  using (workspace_id in (select public.my_workspaces('editor')))
  with check (workspace_id in (select public.my_workspaces('editor')));
-- Processing fields belong to the worker.
revoke update on public.sources from authenticated;
grant update (title, url, content, question, status, jurisdiction, source_type, citation,
              effective_date, superseded, metadata, refresh_hours)
  on public.sources to authenticated;

drop policy if exists chunks_read on public.chunks;
create policy chunks_read on public.chunks for select to authenticated
  using (workspace_id in (select public.my_workspaces('viewer')));
-- Chunks are written by the worker only.
revoke insert, update, delete on public.chunks from authenticated;

-- ── Worker helper: store a batch of embeddings in one statement ────────────
-- Embeddings arrive as text ('[0.1,0.2,...]') from the Edge Function.
create or replace function public.set_chunk_embeddings(p_ids uuid[], p_embeddings text[])
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  n int;
begin
  update chunks c set embedding = u.e::vector(1024)
  from unnest(p_ids, p_embeddings) as u(id, e)
  where c.id = u.id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.set_chunk_embeddings(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.set_chunk_embeddings(uuid[], text[]) to service_role;
