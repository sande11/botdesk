/** One source: its details, legal metadata, the passages it was split into, and actions. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Badge, ErrorBox, Loading, Notice, Tabs } from '@/components/ui/display.tsx'
import { Field, Input, Select, Textarea } from '@/components/ui/form.tsx'
import { Dialog, useConfirm } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { bytes, dateTime, num, timeAgo } from '@/lib/format.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { Chunk, KnowledgeBase, Source } from '@/lib/types.ts'
import { KIND_INFO, LegalFields, legalPatch, type LegalMeta, SOURCE_TYPE_LABEL, StatusBadge } from './shared.tsx'

interface Draft {
  title: string
  content: string
  question: string
  refresh: string
  legal: LegalMeta
  superseded: boolean
}

function fromSource(s: Source): Draft {
  return {
    title: s.title,
    content: s.content ?? '',
    question: s.question ?? '',
    refresh: s.refresh_hours ? String(s.refresh_hours) : '',
    legal: { jurisdiction: s.jurisdiction ?? '', source_type: s.source_type ?? '', citation: s.citation ?? '', effective_date: s.effective_date ?? '' },
    superseded: s.superseded,
  }
}

export function SourceDrawer({ kb, sourceId, onClose }: { kb: KnowledgeBase; sourceId: string | null; onClose: () => void }) {
  const { can, workspace } = useWorkspace()
  const qc = useQueryClient()
  const { confirm, element } = useConfirm()
  const [tab, setTab] = useState('details')
  const source = useQuery({
    queryKey: ['source', sourceId],
    enabled: !!sourceId,
    refetchInterval: (q) => (['queued', 'processing'].includes((q.state.data as Source | undefined)?.status ?? '') ? 3000 : false),
    queryFn: async () => unwrap(await supabase.from('sources').select('*').eq('id', sourceId!).single()) as Source,
  })
  const s = source.data
  const chunks = useQuery({
    queryKey: ['chunks', sourceId, s?.last_indexed_at],
    enabled: !!sourceId && tab === 'passages',
    queryFn: async () =>
      unwrap(await supabase.from('chunks').select('id, ordinal, content, heading, section, token_count').eq('source_id', sourceId!).order('ordinal').limit(300)) as Chunk[],
  })
  const pages = useQuery({
    queryKey: ['source-pages', sourceId],
    enabled: !!sourceId && s?.kind === 'sitemap' && tab === 'pages',
    queryFn: async () =>
      unwrap(await supabase.from('sources').select('id, title, url, status, error, chunk_count, progress').eq('parent_id', sourceId!).order('url').limit(500)) as Source[],
  })

  // Unsaved edits sit on top of the saved source; opening another source drops them.
  const [edits, setDraft] = useState<Draft | null>(null)
  const [openFor, setOpenFor] = useState(sourceId)
  if (openFor !== sourceId) {
    setOpenFor(sourceId)
    setDraft(null)
    setTab('details')
  }
  const draft: Draft | null = edits ?? (s ? fromSource(s) : null)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['source', sourceId] })
    qc.invalidateQueries({ queryKey: ['sources', kb.id] })
    qc.invalidateQueries({ queryKey: ['kb-stats', workspace.id] })
  }
  const update = useMutation({
    mutationFn: async (patch: Partial<Source>) => unwrap(await supabase.from('sources').update(patch).eq('id', sourceId!)),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('sources').delete().eq('id', sourceId!)),
    onSuccess: () => {
      refresh()
      toast.success('Source deleted.')
      onClose()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const download = async () => {
    if (!s?.storage_path) return
    const { data, error } = await supabase.storage.from('sources').createSignedUrl(s.storage_path, 60, { download: true })
    if (error || !data) return toast.error(error?.message ?? 'Could not get the file.')
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const editor = can('editor')
  const dirty = !!(s && draft) && (
    draft.title !== s.title || draft.content !== (s.content ?? '') || draft.question !== (s.question ?? '') ||
    draft.refresh !== (s.refresh_hours ? String(s.refresh_hours) : '') || draft.superseded !== s.superseded ||
    draft.legal.jurisdiction !== (s.jurisdiction ?? '') || draft.legal.source_type !== (s.source_type ?? '') ||
    draft.legal.citation !== (s.citation ?? '') || draft.legal.effective_date !== (s.effective_date ?? '')
  )
  const save = () => {
    if (!s || !draft) return
    const patch: Partial<Source> = { title: draft.title.trim() || s.title }
    if (s.kind === 'text' || s.kind === 'qa') patch.content = draft.content
    if (s.kind === 'qa') patch.question = draft.question
    if (s.kind === 'url' || s.kind === 'sitemap') patch.refresh_hours = draft.refresh ? Number(draft.refresh) : null
    if (kb.legal) Object.assign(patch, legalPatch(draft.legal), { superseded: draft.superseded })
    update.mutate(patch, { onSuccess: () => {
      setDraft(null)
      toast.success(patch.content !== undefined && patch.content !== s.content ? 'Saved. Re-indexing.' : 'Saved.')
    } })
  }

  return (
    <Dialog
      side
      open={!!sourceId}
      onOpenChange={(v) => !v && onClose()}
      title={s ? <span className="flex items-center gap-2"><span className="truncate">{s.title || 'Untitled'}</span></span> : 'Source'}
      description={s ? <span className="flex flex-wrap items-center gap-2">{KIND_INFO[s.kind].label} · added {timeAgo(s.created_at)} <StatusBadge source={s} /></span> : undefined}
      footer={s && editor && (
        <>
          <Button variant="danger-ghost" icon={<Trash2 />} className="mr-auto" onClick={async () => {
            if (await confirm(`Delete “${s.title}”?`, { body: s.kind === 'sitemap' ? 'Its pages and their passages are deleted too. The bot stops using them right away.' : 'Its passages are deleted and the bot stops using it right away.' })) remove.mutate()
          }}>Delete</Button>
          {s.status === 'disabled' ? (
            <Button icon={<Play />} onClick={() => update.mutate({ status: 'queued' })}>Enable</Button>
          ) : (
            <Button icon={<Pause />} onClick={() => update.mutate({ status: 'disabled' })}>Disable</Button>
          )}
          <Button icon={<RefreshCw />} disabled={s.status === 'queued' || s.status === 'processing'} onClick={() => update.mutate({ status: 'queued' }, { onSuccess: () => toast.success('Re-indexing.') })}>Re-index</Button>
          <Button variant="primary" disabled={!dirty} loading={update.isPending} onClick={save}>Save</Button>
        </>
      )}
    >
      {source.isLoading || !s || !draft ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-5">
          {s.status === 'failed' && s.error && <ErrorBox error={new Error(s.error)} />}
          {s.superseded && <Notice tone="warning" title="Superseded">The bot doesn't use this source.</Notice>}

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'details', label: 'Details' },
              { value: 'passages', label: `Passages${s.chunk_count ? ` (${num(s.chunk_count)})` : ''}`, hidden: s.kind === 'sitemap' },
              { value: 'pages', label: 'Pages', hidden: s.kind !== 'sitemap' },
            ]}
          />

          {tab === 'details' && (
            <div className="flex flex-col gap-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                {s.url && (
                  <Meta label="Link" wide>
                    <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-primary-text hover:underline">
                      <span className="truncate">{s.url}</span><ExternalLink className="size-3 shrink-0" />
                    </a>
                  </Meta>
                )}
                {s.storage_path && (
                  <Meta label="File" wide>
                    <button type="button" onClick={download} className="inline-flex items-center gap-1 text-primary-text hover:underline">
                      <Download className="size-3.5" />{s.storage_path.split('/').pop()} {s.bytes ? `(${bytes(s.bytes)})` : ''}
                    </button>
                  </Meta>
                )}
                <Meta label="Passages">{num(s.chunk_count)}</Meta>
                <Meta label="Tokens">{num(s.token_count)}</Meta>
                <Meta label="Last indexed">{dateTime(s.last_indexed_at)}</Meta>
                <Meta label="Updated">{timeAgo(s.updated_at)}</Meta>
                {kb.legal && s.source_type && <Meta label="Type">{SOURCE_TYPE_LABEL[s.source_type]}</Meta>}
                {kb.legal && s.jurisdiction && <Meta label="Jurisdiction"><Badge>{s.jurisdiction}</Badge></Meta>}
              </dl>

              <Field label="Name">
                <Input value={draft.title} disabled={!editor} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              {s.kind === 'qa' && (
                <Field label="Question">
                  <Input value={draft.question} disabled={!editor} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
                </Field>
              )}
              {(s.kind === 'text' || s.kind === 'qa') && (
                <Field label={s.kind === 'qa' ? 'Answer' : 'Text'} hint={editor ? 'Saving changes re-indexes it.' : undefined}>
                  <Textarea rows={s.kind === 'qa' ? 5 : 12} value={draft.content} disabled={!editor} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
                </Field>
              )}
              {(s.kind === 'url' || s.kind === 'sitemap') && (
                <Field label="Keep up to date">
                  <Select value={draft.refresh} disabled={!editor} onChange={(e) => setDraft({ ...draft, refresh: e.target.value })}>
                    <option value="">Never</option>
                    <option value="24">Every day</option>
                    <option value="168">Every week</option>
                    <option value="720">Every month</option>
                    {draft.refresh && !['24', '168', '720'].includes(draft.refresh) && <option value={draft.refresh}>Every {draft.refresh} hours</option>}
                  </Select>
                </Field>
              )}
              {kb.legal && (
                <fieldset disabled={!editor} className="flex flex-col gap-3 rounded-xl border border-border p-4">
                  <legend className="px-1 text-[13px] font-semibold">Legal details</legend>
                  <LegalFields
                    value={draft.legal}
                    onChange={(legal) => setDraft({ ...draft, legal })}
                    superseded={{ checked: draft.superseded, onChange: (v) => setDraft({ ...draft, superseded: v }) }}
                  />
                </fieldset>
              )}
            </div>
          )}

          {tab === 'passages' && (
            chunks.isLoading ? <Loading /> : !chunks.data?.length ? (
              <p className="py-8 text-center text-sm text-muted">{s.status === 'ready' ? 'No text was found in this source.' : 'Passages appear here once indexing finishes.'}</p>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {chunks.data.map((c) => <ChunkItem key={c.id} chunk={c} />)}
                {chunks.data.length >= 300 && <p className="text-center text-xs text-muted">Showing the first 300 passages.</p>}
              </ol>
            )
          )}

          {tab === 'pages' && (
            pages.isLoading ? <Loading /> : !pages.data?.length ? (
              <p className="py-8 text-center text-sm text-muted">{s.status === 'failed' ? 'No pages were found.' : 'Pages appear here once BotDesk has read the site.'}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {pages.data.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <a href={p.url ?? '#'} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" title={p.error ?? undefined}>
                      {p.url?.replace(/^https?:\/\//, '')}
                    </a>
                    <span className="text-xs text-muted tabular-nums">{p.chunk_count || ''}</span>
                    <StatusBadge source={p} />
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
      {element}
    </Dialog>
  )
}

function Meta({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  )
}

function ChunkItem({ chunk }: { chunk: Chunk }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-xl border border-border p-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
        <span className="font-mono tabular-nums">#{chunk.ordinal + 1}</span>
        {chunk.section && <Badge tone="primary">{chunk.section}</Badge>}
        <span className="min-w-0 flex-1 truncate">{chunk.heading}</span>
        <span className="tabular-nums">{chunk.token_count} tokens</span>
      </div>
      <p className={open ? 'text-[13px] whitespace-pre-wrap' : 'line-clamp-4 text-[13px] whitespace-pre-wrap'}>{chunk.content}</p>
      {chunk.content.length > 320 && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs font-medium text-primary-text hover:underline">
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </li>
  )
}
