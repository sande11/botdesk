import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { Badge, Card, CardHeader, Loading, Meter, Stat } from '@/components/ui/display.tsx'
import { unwrap } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { compact, num, usd } from '@/lib/format.ts'
import { usePlans, useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { UsageMonth } from '@/lib/types.ts'

const monthStart = () => {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export function UsageTab() {
  const { workspace, plan, can } = useWorkspace()
  const plans = usePlans()
  const months = useQuery({
    queryKey: ['usage-monthly', workspace.id],
    queryFn: async () => unwrap(await supabase.from('usage_monthly').select('*').eq('workspace_id', workspace.id).order('period', { ascending: false }).limit(12)) as UsageMonth[],
  })
  const counts = useQuery({
    queryKey: ['usage-counts', workspace.id],
    queryFn: async () => {
      const [b, s, m] = await Promise.all([
        supabase.from('bots').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
        supabase.from('sources').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).is('parent_id', null),
        supabase.from('workspace_members').select('user_id', { count: 'exact', head: true }).eq('workspace_id', workspace.id),
      ])
      return { bots: b.count ?? 0, sources: s.count ?? 0, members: m.count ?? 0 }
    },
  })
  // Per-model breakdown is admin-only (usage_events RLS).
  const breakdown = useQuery({
    queryKey: ['usage-breakdown', workspace.id],
    enabled: can('admin'),
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc('usage_breakdown', { p_workspace: workspace.id, p_since: monthStart().toISOString() })) as {
        kind: string; model: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number; platform: boolean
      }[]
      return rows.map((r) => ({
        kind: r.kind, model: r.model, calls: Number(r.calls), input: Number(r.input_tokens), output: Number(r.output_tokens),
        cost: Number(r.cost_usd), platform: r.platform,
      }))
    },
  })

  if (months.isLoading) return <Loading />
  const period = monthStart().toISOString().slice(0, 10)
  const current = months.data?.find((m) => m.period === period)
  const limits = plan?.limits
  const used = current?.messages ?? 0

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-[13px] text-muted">Answered messages this month</p>
            <p className="text-3xl font-semibold tabular-nums">{num(used)}<span className="text-base font-normal text-muted"> / {limits?.messages_per_month == null ? 'unlimited' : num(limits.messages_per_month)}</span></p>
          </div>
          <Badge tone="primary">{plan?.name ?? workspace.plan} plan</Badge>
        </div>
        {limits?.messages_per_month != null && <Meter value={used} max={limits.messages_per_month} />}
        <p className="mt-2 text-xs text-muted">Counts answers sent to customers on any channel, plus playground tests and evals that use BotDesk's AI keys. Resets on the 1st (UTC).</p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tokens in" value={compact(current?.input_tokens ?? 0)} sub="Prompts and sources" />
        <Stat label="Tokens out" value={compact(current?.output_tokens ?? 0)} sub="Answers" />
        <Stat label="Embedding tokens" value={compact(current?.embedding_tokens ?? 0)} sub="Indexing and search" />
        <Stat label="Model cost (est.)" value={usd(Number(current?.cost_usd ?? 0))} sub="At list prices" />
      </div>

      <Card>
        <CardHeader title="Plan limits" />
        <div className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-3">
          {([
            ['Bots', counts.data?.bots ?? 0, limits?.bots],
            ['Sources', counts.data?.sources ?? 0, limits?.sources],
            ['Members', counts.data?.members ?? 0, limits?.members],
          ] as const).map(([label, value, max]) => (
            <div key={label}>
              <div className="mb-1.5 flex justify-between text-[13px]">
                <span className="font-medium">{label}</span>
                <span className="text-muted tabular-nums">{value} / {max == null ? '∞' : max}</span>
              </div>
              <Meter value={value} max={max ?? null} />
            </div>
          ))}
        </div>
      </Card>

      {can('admin') && !!breakdown.data?.length && (
        <Card>
          <CardHeader title="This month by model" description="Calls made with BotDesk's keys are marked; the rest used your own provider keys." />
          <div className="scroll-thin overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Model</th>
                  <th className="px-3 py-2.5 font-medium">Used for</th>
                  <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tokens in</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tokens out</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cost (est.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {breakdown.data.map((r) => (
                  <tr key={`${r.kind}:${r.model}`}>
                    <td className="px-5 py-2.5 font-mono text-xs">{r.model}{r.platform && <Badge tone="info" className="ml-2 font-sans">BotDesk key</Badge>}</td>
                    <td className="px-3 py-2.5 text-muted capitalize">{r.kind}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(r.calls)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{compact(r.input)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{compact(r.output)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{usd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-5 py-2.5 text-xs text-muted">Estimates use public list prices and may differ from your provider's invoice.</p>
        </Card>
      )}

      {!!months.data?.length && (
        <Card>
          <CardHeader title="History" />
          <div className="scroll-thin overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Month</th>
                  <th className="px-3 py-2.5 text-right font-medium">Messages</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cost (est.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {months.data.map((m) => (
                  <tr key={m.period}>
                    <td className="px-5 py-2.5">{new Date(`${m.period}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(m.messages)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{compact(m.input_tokens + m.output_tokens + m.embedding_tokens)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{usd(Number(m.cost_usd))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Plans" description="To change plan, contact your BotDesk administrator." />
        <div className="grid gap-3 border-t border-border p-5 sm:grid-cols-2 xl:grid-cols-4">
          {plans.data?.map((p) => (
            <div key={p.id} className={cn('flex flex-col gap-2 rounded-xl border p-4', p.id === workspace.plan ? 'border-primary bg-primary-soft/40' : 'border-border')}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">{p.name}</p>
                {p.id === workspace.plan && <Badge tone="primary">Current</Badge>}
              </div>
              <p className="text-xl font-semibold">{p.price_cents ? `$${p.price_cents / 100}` : p.id === 'free' ? '$0' : 'Custom'}<span className="text-xs font-normal text-muted">{p.price_cents ? ' / month' : ''}</span></p>
              <ul className="flex flex-col gap-1 text-[13px] text-muted">
                {[
                  `${p.limits.messages_per_month == null ? 'Unlimited' : num(p.limits.messages_per_month)} messages / month`,
                  `${p.limits.bots ?? 'Unlimited'} bot${p.limits.bots === 1 ? '' : 's'}`,
                  `${p.limits.sources == null ? 'Unlimited' : num(p.limits.sources)} sources`,
                  `${p.limits.members ?? 'Unlimited'} members`,
                  p.limits.platform_ai ? 'BotDesk AI keys included' : 'Bring your own AI keys',
                ].map((f) => <li key={f} className="flex items-start gap-1.5"><Check className="mt-0.5 size-3.5 shrink-0 text-success" />{f}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
