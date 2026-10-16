import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, Empty, Loading } from '@/components/ui/display.tsx'
import { Switch } from '@/components/ui/form.tsx'
import { unwrap } from '@/lib/api.ts'
import { useKnowledgeBases } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { Bot } from '@/lib/types.ts'
import { useKbStats } from '../knowledge/KnowledgePage.tsx'

export function KnowledgeTab({ bot }: { bot: Bot }) {
  const { workspace, base, can } = useWorkspace()
  const kbs = useKnowledgeBases()
  const qc = useQueryClient()
  const links = useQuery({
    queryKey: ['bot-kbs', bot.id],
    queryFn: async () => new Set((unwrap(await supabase.from('bot_knowledge_bases').select('knowledge_base_id').eq('bot_id', bot.id)) as { knowledge_base_id: string }[]).map((r) => r.knowledge_base_id)),
  })
  const counts = useKbStats()
  const toggle = useMutation({
    mutationFn: async ({ kb, on }: { kb: string; on: boolean }) => {
      if (on) unwrap(await supabase.from('bot_knowledge_bases').insert({ bot_id: bot.id, knowledge_base_id: kb, workspace_id: workspace.id }))
      else unwrap(await supabase.from('bot_knowledge_bases').delete().eq('bot_id', bot.id).eq('knowledge_base_id', kb))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bot-kbs', bot.id] }),
    onError: (e) => toast.error((e as Error).message),
  })

  if (kbs.isLoading || links.isLoading) return <Loading />
  return (
    <Card>
      <CardHeader
        title="Knowledge bases"
        description="The bot answers only from the knowledge bases switched on here."
        actions={can('editor') && <Link to={`${base}/knowledge`}><Button size="sm" icon={<Plus />}>Manage knowledge</Button></Link>}
      />
      {!kbs.data?.length ? (
        <Empty icon={<BookOpen />} title="No knowledge bases yet" description="Create one and add documents, web pages or Q&A." action={<Link to={`${base}/knowledge`}><Button variant="primary">Go to Knowledge</Button></Link>} />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {kbs.data.map((kb) => {
            const c = counts.data?.get(kb.id)
            return (
              <li key={kb.id} className="flex items-center gap-4 px-5 py-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"><BookOpen className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={`${base}/knowledge/${kb.id}`} className="truncate font-medium hover:underline">{kb.name}</Link>
                    {kb.legal && <Badge tone="primary">Legal</Badge>}
                  </div>
                  <p className="text-[13px] text-muted">
                    {c ? `${c.ready} of ${c.total} sources ready` : 'No sources'} · {kb.embedding_model}
                  </p>
                </div>
                <Switch
                  checked={links.data!.has(kb.id)}
                  disabled={!can('editor') || toggle.isPending}
                  onChange={(on) => toggle.mutate({ kb: kb.id, on })}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
