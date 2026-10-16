/** For BotDesk operators: every workspace, its plan, features and usage this month. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Search, Shield } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Page } from '@/components/layout/AppShell.tsx'
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat } from '@/components/ui/display.tsx'
import { Input, Select, Switch } from '@/components/ui/form.tsx'
import { admin } from '@/lib/api.ts'
import { compact, num, timeAgo, usd } from '@/lib/format.ts'
import { usePlans, useProfile } from '@/lib/session.tsx'

interface Row {
  id: string
  name: string
  slug: string
  plan: string
  features: { legal?: boolean } & Record<string, unknown>
  created_at: string
  members: number
  messages_this_month: number
  cost_this_month: number
}

export default function PlatformPage() {
  const profile = useProfile()
  const plans = usePlans()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const list = useQuery({
    queryKey: ['platform-workspaces'],
    enabled: profile.data?.is_platform_admin === true,
    queryFn: () => admin<{ workspaces: Row[] }>('/platform/workspaces'),
  })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Row, 'plan' | 'features'>> }) =>
      admin(`/platform/workspaces/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-workspaces'] })
      toast.success('Saved.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  if (profile.isLoading) return <Loading />
  if (!profile.data?.is_platform_admin) {
    return <Page><Empty icon={<Shield />} title="Platform admins only" action={<Link to="/" className="text-sm font-medium text-primary-text underline">Back to BotDesk</Link>} /></Page>
  }

  const rows = (list.data?.workspaces ?? []).filter((w) => !q || `${w.name} ${w.slug}`.toLowerCase().includes(q.toLowerCase()))
  const totals = (list.data?.workspaces ?? []).reduce((a, w) => ({ messages: a.messages + w.messages_this_month, cost: a.cost + w.cost_this_month }), { messages: 0, cost: 0 })

  return (
    <Page wide>
      <PageHeader
        back={<Link to="/" className="mb-1 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-4" />BotDesk</Link>}
        title="Platform"
        description="All workspaces on this BotDesk installation."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Workspaces" value={num(list.data?.workspaces.length ?? 0)} />
        <Stat label="Legal pack" value={num(list.data?.workspaces.filter((w) => w.features?.legal).length ?? 0)} />
        <Stat label="Messages this month" value={compact(totals.messages)} />
        <Stat label="Model cost this month" value={usd(totals.cost)} sub="Estimated, all keys" />
      </div>
      <ErrorBox error={list.error} />
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a workspace" className="pl-9" aria-label="Find a workspace" />
          </div>
        </div>
        {list.isLoading ? <Loading /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Workspace</th>
                  <th className="px-3 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium">Legal pack</th>
                  <th className="px-3 py-2.5 text-right font-medium">Members</th>
                  <th className="px-3 py-2.5 text-right font-medium">Messages</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-5 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{w.name}</p>
                      <p className="font-mono text-xs text-muted">{w.slug}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Select aria-label={`Plan for ${w.name}`} className="h-8 w-[130px] text-[13px]" value={w.plan} onChange={(e) => update.mutate({ id: w.id, patch: { plan: e.target.value } })}>
                        {plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </td>
                    <td className="px-3 py-2.5">
                      <Switch checked={w.features?.legal === true} onChange={(v) => update.mutate({ id: w.id, patch: { features: { ...w.features, legal: v } } })} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{w.members}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(w.messages_this_month)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{usd(w.cost_this_month)}</td>
                    <td className="px-5 py-2.5 whitespace-nowrap text-muted">{timeAgo(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="py-10 text-center text-sm text-muted">No workspaces match.</p>}
          </div>
        )}
      </Card>
    </Page>
  )
}
