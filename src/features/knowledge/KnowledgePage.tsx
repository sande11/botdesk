import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Bot as BotIcon, Layers, Plus, Scale } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Page } from '@/components/layout/AppShell.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, Empty, ErrorBox, Meter, PageHeader, Skeleton } from '@/components/ui/display.tsx'
import { Field, Input, Switch, Textarea } from '@/components/ui/form.tsx'
import { Dialog } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { compact, timeAgo } from '@/lib/format.ts'
import { useBots, useKnowledgeBases } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { KnowledgeBase } from '@/lib/types.ts'
import { EmbeddingSelect } from './shared.tsx'

interface KbStats {
  /** Sources that count toward the plan (a website counts once). */
  top: number
  total: number
  ready: number
  failed: number
  busy: number
  chunks: number
  tokens: number
  last: string | null
}

export function useKbStats() {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['kb-stats', workspace.id],
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc('knowledge_stats', { p_workspace: workspace.id })) as {
        knowledge_base_id: string; top_level: number; documents: number; ready: number; failed: number; busy: number
        chunks: number; tokens: number; last_indexed_at: string | null
      }[]
      return new Map<string, KbStats>(rows.map((r) => [r.knowledge_base_id, {
        top: r.top_level, total: r.documents, ready: r.ready, failed: r.failed, busy: r.busy,
        chunks: Number(r.chunks), tokens: Number(r.tokens), last: r.last_indexed_at,
      }]))
    },
  })
}

export default function KnowledgePage() {
  const { workspace, base, can, plan } = useWorkspace()
  const kbs = useKnowledgeBases()
  const stats = useKbStats()
  const bots = useBots()
  const links = useQuery({
    queryKey: ['bot-kb-links', workspace.id],
    queryFn: async () => unwrap(await supabase.from('bot_knowledge_bases').select('bot_id, knowledge_base_id').eq('workspace_id', workspace.id)) as { bot_id: string; knowledge_base_id: string }[],
  })
  const [creating, setCreating] = useState(false)
  const totalSources = [...(stats.data?.values() ?? [])].reduce((a, s) => a + s.top, 0)
  const limit = plan?.limits.sources ?? null

  return (
    <Page>
      <PageHeader
        title="Knowledge"
        description="Everything your bots can answer from. Add documents, web pages and Q&A; BotDesk splits them into passages and indexes them for search."
        actions={can('editor') && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New knowledge base</Button>}
      />

      {limit != null && (
        <Card className="mb-6 flex items-center gap-4 px-5 py-3.5">
          <Layers className="size-4 text-muted" />
          <div className="flex-1">
            <div className="mb-1.5 flex justify-between text-[13px]">
              <span className="font-medium">Sources</span>
              <span className="text-muted tabular-nums">{totalSources} of {limit} on the {plan?.name} plan</span>
            </div>
            <Meter value={totalSources} max={limit} />
          </div>
        </Card>
      )}

      <ErrorBox error={kbs.error} />
      {kbs.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : !kbs.data?.length ? (
        <Card>
          <Empty
            icon={<BookOpen />}
            title="No knowledge yet"
            description="A knowledge base is a collection of sources, like your help centre, policies or the laws your bot explains. Bots can use one or several."
            action={can('editor') && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create a knowledge base</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {kbs.data.map((kb) => {
            const s = stats.data?.get(kb.id)
            const usedBy = (links.data ?? []).filter((l) => l.knowledge_base_id === kb.id).map((l) => bots.data?.find((b) => b.id === l.bot_id)?.name).filter(Boolean)
            return (
              <Link key={kb.id} to={`${base}/knowledge/${kb.id}`} className="group">
                <Card className="flex h-full flex-col gap-4 p-5 transition-colors group-hover:border-border-strong">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-text">
                      {kb.legal ? <Scale className="size-5" /> : <BookOpen className="size-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold">{kb.name}</h3>
                        {kb.legal && <Badge tone="primary">Legal</Badge>}
                      </div>
                      <p className="line-clamp-2 text-[13px] text-muted">{kb.description || kb.embedding_model}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Mini label="Sources" value={s ? `${s.ready}/${s.total}` : '0'} />
                    <Mini label="Passages" value={compact(s?.chunks ?? 0)} />
                    <Mini label="Tokens" value={compact(s?.tokens ?? 0)} />
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted">
                    {s?.busy ? <Badge tone="info">{s.busy} indexing</Badge> : null}
                    {s?.failed ? <Badge tone="danger">{s.failed} failed</Badge> : null}
                    <span className="inline-flex items-center gap-1"><BotIcon className="size-3.5" />{usedBy.length ? usedBy.join(', ') : 'No bots yet'}</span>
                    <span className="ml-auto">{s?.last ? `Updated ${timeAgo(s.last)}` : ''}</span>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
      <CreateKbDialog open={creating} onOpenChange={setCreating} />
    </Page>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2">
      <div className="text-[15px] font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  )
}

export function CreateKbDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspace, base, legal } = useWorkspace()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isLegal, setIsLegal] = useState(legal)
  const [embedding, setEmbedding] = useState<{ provider: KnowledgeBase['embedding_provider']; model: string }>({ provider: 'openai', model: 'text-embedding-3-small' })
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase.from('knowledge_bases').insert({
          workspace_id: workspace.id, name: name.trim(), description: description.trim(), legal: isLegal,
          embedding_provider: embedding.provider, embedding_model: embedding.model,
        }).select('id').single(),
      ) as { id: string },
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ['kbs', workspace.id] })
      onOpenChange(false)
      setName('')
      setDescription('')
      navigate(`${base}/knowledge/${id}?add=1`)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New knowledge base"
      description="Group sources that belong together. You choose which bots use it."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>Create</Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={legal ? 'Malawi laws' : 'Help centre'} />
        </Field>
        <Field label="Description" optional>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's in it and who it's for" />
        </Field>
        <EmbeddingSelect
          value={`${embedding.provider}:${embedding.model}`}
          legal={isLegal}
          onChange={(provider, model) => setEmbedding({ provider, model })}
        />
        {legal && (
          <Switch
            checked={isLegal}
            onChange={setIsLegal}
            label="Legal sources"
            description="Adds jurisdiction, document type, citation and in-force date to every source, and detects sections (s. 29, Art. 5) for citations."
          />
        )}
      </form>
    </Dialog>
  )
}
