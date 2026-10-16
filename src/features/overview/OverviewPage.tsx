import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Check, CircleHelp, Inbox, KeyRound, MessagesSquare, Plug, Sparkles, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Page } from '@/components/layout/AppShell.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardHeader, Empty, Meter, PageHeader, Skeleton, Stat } from '@/components/ui/display.tsx'
import { unwrap } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { CHANNEL_LABEL, compact, num, pct, timeAgo } from '@/lib/format.ts'
import { useBots } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { UsageMonth } from '@/lib/types.ts'
import { QuickAnswerDialog } from '../knowledge/QuickAnswerDialog.tsx'

interface Stats {
  daily: { day: string; answered: number; unanswered: number }[]
  conversations: number
  answered: number
  unanswered: number
  handoffs: number
  by_channel: Record<string, number>
  gaps: { question: string; at: string; conversation_id: string }[]
  top_sources: { title: string; source_id: string; uses: number }[]
}

function useSetup() {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['setup', workspace.id],
    queryFn: async () => {
      const [ready, live, keys, conv] = await Promise.all([
        supabase.from('sources').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('status', 'ready'),
        supabase.from('bots').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('status', 'live'),
        supabase.from('api_keys').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).is('revoked_at', null),
        supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
      ])
      return { sources: ready.count ?? 0, live: live.count ?? 0, keys: keys.count ?? 0, conversations: conv.count ?? 0 }
    },
  })
}

function SetupChecklist() {
  const { base, can } = useWorkspace()
  const setup = useSetup()
  const bots = useBots()
  if (!setup.data) return null
  const firstBot = bots.data?.[0]
  const steps = [
    { done: setup.data.sources > 0, icon: <BookOpen />, title: 'Add knowledge', body: 'Upload documents, add web pages or write Q&A.', to: `${base}/knowledge` },
    { done: setup.data.conversations > 0, icon: <Sparkles />, title: 'Try your bot', body: 'Ask it questions in the playground and see its sources.', to: firstBot ? `${base}/bots/${firstBot.id}/playground` : `${base}/bots` },
    { done: setup.data.live > 0 && setup.data.keys > 0, icon: <Plug />, title: 'Put it live', body: 'Embed the widget, call the API, or connect WhatsApp and SMS.', to: firstBot ? `${base}/bots/${firstBot.id}/channels` : `${base}/bots` },
    { done: false, icon: <KeyRound />, title: 'Add your model keys', body: 'Optional: use your own Anthropic, OpenAI or Voyage keys.', to: `${base}/settings/models`, hidden: !can('admin') },
  ].filter((s) => !s.hidden)
  if (steps.slice(0, 3).every((s) => s.done)) return null
  const doneCount = steps.filter((s) => s.done).length

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title="Get started" description={`${doneCount} of ${steps.length} done`} />
      <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <Link key={s.title} to={s.to} className="group flex gap-3 bg-surface p-4 transition-colors hover:bg-surface-2">
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-4', s.done ? 'bg-success-soft text-success' : 'bg-primary-soft text-primary-text')}>
              {s.done ? <Check /> : s.icon}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className={cn('text-sm font-semibold', s.done && 'text-muted line-through')}>{s.title}</span>
              <span className="text-[13px] text-muted">{s.body}</span>
            </span>
          </Link>
        ))}
      </div>
    </Card>
  )
}

export default function OverviewPage() {
  const { workspace, base, plan, can } = useWorkspace()
  const [days, setDays] = useState(30)
  const [gap, setGap] = useState<string | null>(null)
  const stats = useQuery({
    queryKey: ['stats', workspace.id, days],
    queryFn: async () => unwrap(await supabase.rpc('workspace_stats', { p_workspace: workspace.id, p_days: days })) as Stats,
  })
  const usage = useQuery({
    queryKey: ['usage-month', workspace.id],
    queryFn: async () => {
      const period = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10)
      const r = await supabase.from('usage_monthly').select('*').eq('workspace_id', workspace.id).eq('period', period).maybeSingle()
      return (r.data as UsageMonth | null) ?? null
    },
  })
  const s = stats.data
  const total = (s?.answered ?? 0) + (s?.unanswered ?? 0)
  const limit = plan?.limits.messages_per_month ?? null

  return (
    <Page>
      <PageHeader
        title="Overview"
        description={`How ${workspace.name}'s assistants are doing.`}
        actions={
          <>
            <select
              aria-label="Period"
              className="h-9 rounded-[10px] border border-border bg-surface px-3 text-sm"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <Link to={`${base}/inbox`}><Button icon={<Inbox />}>Open inbox</Button></Link>
          </>
        }
      />

      <SetupChecklist />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Conversations" icon={<MessagesSquare />} value={s ? compact(s.conversations) : <Skeleton className="h-8 w-16" />}
          sub={s && Object.keys(s.by_channel).length ? Object.entries(s.by_channel).map(([c, n]) => `${CHANNEL_LABEL[c] ?? c} ${n}`).join(' · ') : 'No conversations yet'} />
        <Stat label="Answer rate" icon={<Check />} value={s ? (total ? pct(s.answered / total) : '—') : <Skeleton className="h-8 w-16" />}
          sub={s ? `${num(s.answered)} answered, ${num(s.unanswered)} not found` : ' '} />
        <Stat label="Handed to people" icon={<UserRound />} value={s ? num(s.handoffs) : <Skeleton className="h-8 w-16" />}
          sub="Conversations that asked for a person" />
        <Card className="flex flex-col gap-2 p-4">
          <div className="text-[13px] text-muted">Messages this month</div>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">
            {num(usage.data?.messages ?? 0)}
            <span className="text-sm font-normal text-muted">{limit ? ` / ${num(limit)}` : ''}</span>
          </div>
          {limit ? <Meter value={usage.data?.messages ?? 0} max={limit} /> : <div className="text-xs text-muted">No monthly limit</div>}
          {can('admin') && <Link to={`${base}/settings/usage`} className="text-xs font-medium text-primary-text hover:underline">Usage details</Link>}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Answers per day" description="Questions the bot answered from your knowledge, and ones it couldn't." />
        <div className="h-64 px-2 pb-4">
          {s ? (
            <ResponsiveContainer>
              <BarChart data={s.daily} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} stroke="var(--subtle)"
                  tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} stroke="var(--subtle)" />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }}
                  labelFormatter={(d) => new Date(String(d)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} />
                <Bar dataKey="answered" name="Answered" stackId="a" fill="var(--primary)" radius={[0, 0, 0, 0]} maxBarSize={28} />
                <Bar dataKey="unanswered" name="Not found" stackId="a" fill="var(--warning)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Skeleton className="h-full w-full" />}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title="Questions it couldn't answer" description="Add an answer and the bot will know next time." />
          {s && !s.gaps.length ? (
            <Empty icon={<CircleHelp />} title="No gaps found" description="Every question in this period was answered from your knowledge." className="py-10" />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {(s?.gaps ?? []).map((g) => (
                <li key={g.conversation_id + g.at} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{g.question}</p>
                    <p className="text-xs text-muted">{timeAgo(g.at)}</p>
                  </div>
                  <Link to={`${base}/inbox/${g.conversation_id}`} className="text-xs font-medium text-muted hover:text-fg">View</Link>
                  {can('editor') && <Button size="sm" onClick={() => setGap(g.question)}>Add answer</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Most cited sources" />
          {s && !s.top_sources.length ? (
            <Empty title="No citations yet" description="Sources show up here once the bot starts answering." className="py-10" />
          ) : (
            <ul className="flex flex-col gap-3 border-t border-border px-5 py-4">
              {(s?.top_sources ?? []).map((t) => {
                const max = s!.top_sources[0].uses
                return (
                  <li key={t.source_id} className="flex flex-col gap-1.5">
                    <div className="flex justify-between gap-3 text-sm"><span className="truncate">{t.title}</span><span className="text-muted tabular-nums">{t.uses}</span></div>
                    <Meter value={t.uses} max={max} tone="primary" />
                  </li>
                )
              })}
            </ul>
          )}
          <div className="border-t border-border px-5 py-3">
            <Link to={`${base}/knowledge`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-text hover:underline">
              Manage knowledge <ArrowRight className="size-4" />
            </Link>
          </div>
        </Card>
      </div>

      <QuickAnswerDialog question={gap ?? ''} open={gap !== null} onOpenChange={(v) => !v && setGap(null)} />
    </Page>
  )
}
