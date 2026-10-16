import { useInfiniteQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardHeader, Empty, Loading } from '@/components/ui/display.tsx'
import { Select } from '@/components/ui/form.tsx'
import { unwrap } from '@/lib/api.ts'
import { dateTime } from '@/lib/format.ts'
import { useMembersById } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { AuditEntry } from '@/lib/types.ts'

const PAGE = 50

const ACTION_LABEL: Record<string, string> = {
  'workspace.created': 'created the workspace',
  'member.invited': 'invited a member',
  'member.joined': 'joined',
  'member.left': 'left the workspace',
  'member.removed': 'removed a member',
  'member.role_changed': 'changed a member’s role',
  'api_key.created': 'created an API key',
  'api_key.revoked': 'revoked an API key',
  'credential.saved': 'saved a provider key',
  'credential.deleted': 'deleted a provider key',
  'review.published': 'published a verified answer',
  'finetune.started': 'started a fine-tune',
  'channel.created': 'connected a channel',
  'channel.secrets_updated': 'updated a channel’s credentials',
  'channel.deleted': 'disconnected a channel',
  'platform.workspace_updated': 'changed the plan or features (platform admin)',
}

export function AuditTab() {
  const { workspace } = useWorkspace()
  const members = useMembersById()
  const [prefix, setPrefix] = useState('')
  const log = useInfiniteQuery({
    queryKey: ['audit', workspace.id, prefix],
    initialPageParam: 0,
    getNextPageParam: (last: AuditEntry[], all) => (last.length === PAGE ? all.length * PAGE : undefined),
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('audit_log').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false }).range(pageParam, pageParam + PAGE - 1)
      if (prefix) q = q.like('action', `${prefix}.%`)
      return unwrap(await q) as AuditEntry[]
    },
  })
  const rows = log.data?.pages.flat() ?? []
  return (
    <Card className="max-w-4xl">
      <CardHeader
        title="Audit log"
        description="Security-relevant changes in this workspace."
        actions={
          <Select aria-label="Filter" value={prefix} onChange={(e) => setPrefix(e.target.value)} className="h-8 w-auto text-[13px]">
            <option value="">Everything</option>
            <option value="member">Members</option>
            <option value="api_key">API keys</option>
            <option value="credential">Provider keys</option>
            <option value="channel">Channels</option>
            <option value="review">Reviews</option>
            <option value="finetune">Fine-tunes</option>
          </Select>
        }
      />
      {log.isLoading ? <Loading /> : !rows.length ? (
        <Empty icon={<History />} title="Nothing logged yet" />
      ) : (
        <>
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((e) => {
              const who = e.actor_id ? members.data?.get(e.actor_id) ?? 'A former member' : e.actor_type === 'system' ? 'BotDesk' : 'Someone'
              const detail = [e.target_id && e.target_type !== 'workspace' ? e.target_id : null, ...Object.entries(e.metadata ?? {}).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`)]
                .filter(Boolean).join(' · ')
              return (
                <li key={e.id} className="flex items-start gap-4 px-5 py-3 text-sm">
                  <span className="w-32 shrink-0 text-xs text-muted tabular-nums">{dateTime(e.created_at)}</span>
                  <div className="min-w-0 flex-1">
                    <p><span className="font-medium">{who}</span> {ACTION_LABEL[e.action] ?? e.action}</p>
                    {detail && <p className="truncate font-mono text-xs text-muted">{detail}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
          {log.hasNextPage && (
            <div className="border-t border-border p-3 text-center">
              <Button size="sm" variant="ghost" loading={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>Load more</Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
