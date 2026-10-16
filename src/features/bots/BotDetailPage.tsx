import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page } from '@/components/layout/AppShell.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Empty, Loading, PageHeader, Tabs } from '@/components/ui/display.tsx'
import { Select } from '@/components/ui/form.tsx'
import { useConfirm } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { Bot } from '@/lib/types.ts'
import { ChannelsTab } from './ChannelsTab.tsx'
import { KnowledgeTab } from './KnowledgeTab.tsx'
import { PlaygroundTab } from './PlaygroundTab.tsx'
import { SetupTab } from './SetupTab.tsx'

export function useBot(botId: string | undefined) {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['bot', botId],
    enabled: !!botId,
    queryFn: async () => unwrap(await supabase.from('bots').select('*').eq('id', botId!).eq('workspace_id', workspace.id).single()) as Bot,
  })
}

export function useUpdateBot(botId: string) {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<Bot>) => unwrap(await supabase.from('bots').update(patch).eq('id', botId).select('*').single()) as Bot,
    onSuccess: (bot) => {
      qc.setQueryData(['bot', botId], bot)
      qc.invalidateQueries({ queryKey: ['bots', workspace.id] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
}

export default function BotDetailPage() {
  const { botId, tab = 'setup' } = useParams()
  const { base, can, workspace } = useWorkspace()
  const bot = useBot(botId)
  const update = useUpdateBot(botId!)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { confirm, element } = useConfirm()
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('bots').delete().eq('id', botId!)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bots', workspace.id] })
      toast.success('Bot deleted.')
      navigate(`${base}/bots`)
    },
  })

  if (bot.isLoading) return <Loading />
  if (!bot.data) return <Page><Empty title="Bot not found" /></Page>
  const b = bot.data

  return (
    <Page>
      <PageHeader
        back={<Link to={`${base}/bots`} className="mb-1 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-4" />Bots</Link>}
        title={b.name}
        description={b.description || undefined}
        actions={can('editor') && (
          <>
            <Select
              aria-label="Status"
              className="w-[130px]"
              value={b.status}
              onChange={(e) => update.mutate({ status: e.target.value as Bot['status'] }, { onSuccess: (x) => toast.success(x.status === 'live' ? 'The bot is live.' : x.status === 'paused' ? 'The bot is paused.' : 'Saved as draft.') })}
            >
              <option value="live">● Live</option>
              <option value="draft">○ Draft</option>
              <option value="paused">❙❙ Paused</option>
            </Select>
            <Button variant="danger-ghost" size="icon" aria-label="Delete bot" onClick={async () => {
              if (await confirm(`Delete ${b.name}?`, { body: 'Its conversations, channels and keys are deleted too. Knowledge bases are kept.' })) remove.mutate()
            }}>
              <Trash2 />
            </Button>
          </>
        )}
      />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={(t) => navigate(`${base}/bots/${b.id}/${t}`)}
        tabs={[
          { value: 'setup', label: 'Setup' },
          { value: 'knowledge', label: 'Knowledge' },
          { value: 'channels', label: 'Channels' },
          { value: 'playground', label: 'Playground' },
        ]}
      />
      {tab === 'setup' && <SetupTab bot={b} />}
      {tab === 'knowledge' && <KnowledgeTab bot={b} />}
      {tab === 'channels' && <ChannelsTab bot={b} />}
      {tab === 'playground' && <PlaygroundTab bot={b} />}
      {element}
    </Page>
  )
}
