-- ============================================================
-- BotDesk v2 — dashboard statistics
-- ============================================================
-- Runs with the caller's rights, so RLS limits it to their workspaces.

create or replace function public.workspace_stats(p_workspace uuid, p_days int default 30)
returns jsonb language sql stable security invoker set search_path = public as $$
  with
  since as (select now() - make_interval(days => greatest(1, least(p_days, 365))) as t),
  days as (
    select generate_series(
      date_trunc('day', now()) - make_interval(days => greatest(1, least(p_days, 365)) - 1),
      date_trunc('day', now()),
      interval '1 day'
    )::date as d
  ),
  answers as (
    select date_trunc('day', m.created_at)::date as d, m.outcome, m.citations, m.conversation_id, m.created_at
    from messages m, since
    where m.workspace_id = p_workspace and m.role = 'assistant' and m.created_at >= since.t
  ),
  convs as (
    select c.channel, c.created_at, c.handoff_at
    from conversations c, since
    where c.workspace_id = p_workspace and c.created_at >= since.t
  )
  select jsonb_build_object(
    'daily', (
      select jsonb_agg(jsonb_build_object('day', days.d, 'answered', coalesce(a.answered, 0), 'unanswered', coalesce(a.unanswered, 0)) order by days.d)
      from days
      left join (
        select d,
               count(*) filter (where outcome = 'answered') as answered,
               count(*) filter (where outcome = 'no_answer') as unanswered
        from answers group by d
      ) a on a.d = days.d
    ),
    'conversations', (select count(*) from convs),
    'answered', (select count(*) from answers where outcome = 'answered'),
    'unanswered', (select count(*) from answers where outcome = 'no_answer'),
    'handoffs', (
      select count(*) from conversations c, since
      where c.workspace_id = p_workspace and c.handoff_at >= since.t
    ),
    'by_channel', (select coalesce(jsonb_object_agg(channel, n), '{}'::jsonb) from (select channel, count(*) as n from convs group by channel) x),
    -- Questions the bot could not answer: the knowledge gaps to fill.
    'gaps', (
      select coalesce(jsonb_agg(g), '[]'::jsonb) from (
        select jsonb_build_object('question', q.content, 'at', a.created_at, 'conversation_id', a.conversation_id) as g
        from answers a
        cross join lateral (
          select u.content from messages u
          where u.conversation_id = a.conversation_id and u.role = 'user' and u.created_at <= a.created_at
          order by u.created_at desc limit 1
        ) q
        where a.outcome = 'no_answer'
        order by a.created_at desc
        limit 8
      ) t
    ),
    'top_sources', (
      select coalesce(jsonb_agg(jsonb_build_object('title', title, 'source_id', source_id, 'uses', n)), '[]'::jsonb) from (
        select c ->> 'title' as title, c ->> 'source_id' as source_id, count(*) as n
        from answers a, jsonb_array_elements(a.citations) c
        group by 1, 2 order by 3 desc limit 6
      ) t
    )
  )
$$;

grant execute on function public.workspace_stats(uuid, int) to authenticated;

-- Per knowledge base totals for the Knowledge page (no row caps).
create or replace function public.knowledge_stats(p_workspace uuid)
returns table (
  knowledge_base_id uuid, top_level int, documents int, ready int, failed int, busy int,
  chunks bigint, tokens bigint, last_indexed_at timestamptz
) language sql stable security invoker set search_path = public as $$
  select s.knowledge_base_id,
         count(*) filter (where s.parent_id is null)::int,
         count(*) filter (where s.kind <> 'sitemap')::int,
         count(*) filter (where s.kind <> 'sitemap' and s.status = 'ready')::int,
         count(*) filter (where s.kind <> 'sitemap' and s.status = 'failed')::int,
         count(*) filter (where s.kind <> 'sitemap' and s.status in ('queued', 'processing'))::int,
         coalesce(sum(s.chunk_count), 0)::bigint,
         coalesce(sum(s.token_count), 0)::bigint,
         max(s.last_indexed_at)
  from sources s
  where s.workspace_id = p_workspace
  group by s.knowledge_base_id
$$;

-- Pages found under each website source of a knowledge base.
create or replace function public.site_page_stats(p_knowledge_base uuid)
returns table (parent_id uuid, pages int, ready int, busy int, chunks bigint)
language sql stable security invoker set search_path = public as $$
  select s.parent_id, count(*)::int,
         count(*) filter (where s.status = 'ready')::int,
         count(*) filter (where s.status in ('queued', 'processing'))::int,
         coalesce(sum(s.chunk_count), 0)::bigint
  from sources s
  where s.knowledge_base_id = p_knowledge_base and s.parent_id is not null
  group by s.parent_id
$$;

-- Usage by kind and model since a date (usage_events is admin-only under RLS).
create or replace function public.usage_breakdown(p_workspace uuid, p_since timestamptz)
returns table (kind text, model text, calls bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric, platform bool)
language sql stable security invoker set search_path = public as $$
  select e.kind, coalesce(e.model, '—'), count(*), sum(e.input_tokens)::bigint, sum(e.output_tokens)::bigint,
         sum(e.cost_usd), bool_or(e.platform_key)
  from usage_events e
  where e.workspace_id = p_workspace and e.created_at >= p_since
  group by e.kind, coalesce(e.model, '—')
  order by sum(e.cost_usd) desc, count(*) desc
$$;

grant execute on function public.knowledge_stats(uuid) to authenticated;
grant execute on function public.site_page_stats(uuid) to authenticated;
grant execute on function public.usage_breakdown(uuid, timestamptz) to authenticated;
