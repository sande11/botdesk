import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot as BotIcon, Cpu, Globe, Plus, Scale } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Page } from '@/components/layout/AppShell.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui/display.tsx'
import { Field, Input, Textarea } from '@/components/ui/form.tsx'
import { Dialog } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { timeAgo } from '@/lib/format.ts'
import { useBots, useKnowledgeBases } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { Bot } from '@/lib/types.ts'

export const STATUS_BADGE: Record<Bot['status'], { tone: 'success' | 'neutral' | 'warning'; label: string }> = {
  live: { tone: 'success', label: 'Live' },
  draft: { tone: 'neutral', label: 'Draft' },
  paused: { tone: 'warning', label: 'Paused' },
}

export default function BotsPage() {
  const { base, can, plan } = useWorkspace()
  const bots = useBots()
  const kbs = useKnowledgeBases()
  const [creating, setCreating] = useState(false)
  const limit = plan?.limits.bots ?? null
  const atLimit = limit != null && (bots.data?.length ?? 0) >= limit

  return (
    <Page>
      <PageHeader
        title="Bots"
        description="Each bot has its own instructions, model, knowledge and channels."
        actions={can('editor') && (
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)} disabled={atLimit} title={atLimit ? `Your plan allows ${limit} bot(s)` : undefined}>
            New bot
          </Button>
        )}
      />
      {bots.isLoading ? <Loading /> : !bots.data?.length ? (
        <Card>
          <Empty icon={<BotIcon />} title="No bots yet" description="Create a bot, give it knowledge, and put it on your site, app, WhatsApp or SMS."
            action={can('editor') && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New bot</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {bots.data.map((b) => (
            <Link key={b.id} to={`${base}/bots/${b.id}`} className="group">
              <Card className="flex h-full flex-col gap-4 p-5 transition-shadow group-hover:shadow-[var(--shadow-md)]">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: b.widget.primary_color ?? 'var(--primary)' }}>
                    {b.legal?.enabled ? <Scale className="size-5" /> : <BotIcon className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold">{b.name}</h3>
                      <Badge tone={STATUS_BADGE[b.status].tone} dot>{STATUS_BADGE[b.status].label}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{b.description || 'No description'}</p>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted [&_svg]:size-3.5">
                  <span className="inline-flex items-center gap-1"><Cpu />{b.model.model}</span>
                  <span className="inline-flex items-center gap-1"><Globe />{b.allowed_domains.length ? `${b.allowed_domains.length} domain${b.allowed_domains.length > 1 ? 's' : ''}` : 'Any site'}</span>
                  <span className="ml-auto">Updated {timeAgo(b.updated_at)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <NewBotDialog open={creating} onOpenChange={setCreating} knowledgeBaseIds={(kbs.data ?? []).map((k) => k.id)} />
    </Page>
  )
}

function NewBotDialog({ open, onOpenChange, knowledgeBaseIds }: { open: boolean; onOpenChange: (v: boolean) => void; knowledgeBaseIds: string[] }) {
  const { workspace, base, legal } = useWorkspace()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = useMutation({
    mutationFn: async () => {
      const bot = unwrap(await supabase.from('bots').insert({
        workspace_id: workspace.id,
        name: name.trim(),
        description: description.trim(),
        status: 'draft',
        model: legal ? { provider: 'anthropic', model: 'claude-sonnet-5-5', max_tokens: 1000 } : { provider: 'anthropic', model: 'claude-haiku-5-5', max_tokens: 800 },
        legal: legal ? { enabled: true, answer_format: 'text', default_jurisdiction: workspace.settings.default_jurisdiction ?? null, review_low_confidence: true } : {},
      }).select('id').single()) as { id: string }
      if (knowledgeBaseIds.length) {
        unwrap(await supabase.from('bot_knowledge_bases').insert(
          knowledgeBaseIds.map((k) => ({ bot_id: bot.id, knowledge_base_id: k, workspace_id: workspace.id })),
        ))
      }
      return bot.id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['bots', workspace.id] })
      onOpenChange(false)
      navigate(`${base}/bots/${id}`)
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New bot"
      description="It starts as a draft, connected to all your knowledge bases. You can change everything later."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create bot</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="bot-name" hint="Shown to people in the chat header.">
          <Input id="bot-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Support assistant" />
        </Field>
        <Field label="Description" htmlFor="bot-desc" optional>
          <Textarea id="bot-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Answers billing and delivery questions on the website." />
        </Field>
        <ErrorBox error={create.error} />
      </div>
    </Dialog>
  )
}
