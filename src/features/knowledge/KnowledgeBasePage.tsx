import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BookOpen, MoreHorizontal, Pause, Play, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Page } from '@/components/layout/AppShell.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, Empty, ErrorBox, Loading, Notice, PageHeader, Segmented, Spinner, Stat, Tabs } from '@/components/ui/display.tsx'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form.tsx'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, useConfirm } from '@/components/ui/overlay.tsx'
import { admin, unwrap } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { compact, num, timeAgo } from '@/lib/format.ts'
import { useKnowledgeBases } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { KnowledgeBase, Source, SourceKind } from '@/lib/types.ts'
import { AddSourceDialog } from './AddSourceDialog.tsx'
import { SourceDrawer } from './SourceDrawer.tsx'
import { EmbeddingSelect, KIND_INFO, KindIcon, SOURCE_TYPE_LABEL, StatusBadge } from './shared.tsx'

const LIST_FIELDS =
  'id, workspace_id, knowledge_base_id, parent_id, kind, title, url, storage_path, mime_type, bytes, question, status, error, token_count, chunk_count, progress, jurisdiction, source_type, citation, effective_date, superseded, refresh_hours, last_indexed_at, created_at, updated_at'

export default function KnowledgeBasePage() {
  const { kbId } = useParams()
  const { base, can } = useWorkspace()
  const kbs = useKnowledgeBases()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState('sources')
  const [adding, setAdding] = useState(params.get('add') === '1')
  const kb = kbs.data?.find((k) => k.id === kbId)

  if (kbs.isLoading) return <Loading />
  if (!kb) return <Page><Empty title="Knowledge base not found" action={<Link to={`${base}/knowledge`}><Button>Back to Knowledge</Button></Link>} /></Page>

  return (
    <Page>
      <PageHeader
        back={<Link to={`${base}/knowledge`} className="mb-1 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeft className="size-4" />Knowledge</Link>}
        title={<span className="flex items-center gap-3">{kb.name}{kb.legal && <Badge tone="primary">Legal</Badge>}</span>}
        description={kb.description || undefined}
        actions={can('editor') && <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>Add sources</Button>}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        tabs={[
          { value: 'sources', label: 'Sources' },
          { value: 'search', label: 'Test search' },
          { value: 'settings', label: 'Settings', hidden: !can('editor') },
        ]}
      />
      {tab === 'sources' && <SourcesTab kb={kb} onAdd={() => setAdding(true)} />}
      {tab === 'search' && <SearchTab kb={kb} />}
      {tab === 'settings' && <SettingsTab kb={kb} />}
      <AddSourceDialog
        kb={kb}
        open={adding}
        onOpenChange={(v) => {
          setAdding(v)
          if (!v && params.has('add')) setParams({}, { replace: true })
        }}
      />
    </Page>
  )
}

// ── Sources ───────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'ready' | 'busy' | 'failed' | 'disabled'

function SourcesTab({ kb, onAdd }: { kb: KnowledgeBase; onAdd: () => void }) {
  const { can, workspace } = useWorkspace()
  const qc = useQueryClient()
  const { confirm, element } = useConfirm()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [kind, setKind] = useState<SourceKind | ''>('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const sources = useQuery({
    queryKey: ['sources', kb.id],
    refetchInterval: (query) => ((query.state.data as Source[] | undefined)?.some((s) => s.status === 'queued' || s.status === 'processing') ? 3000 : false),
    queryFn: async () =>
      unwrap(await supabase.from('sources').select(LIST_FIELDS).eq('knowledge_base_id', kb.id).is('parent_id', null).order('created_at', { ascending: false }).limit(1000)) as Source[],
  })
  const childStats = useQuery({
    queryKey: ['sources', kb.id, 'children', sources.dataUpdatedAt],
    enabled: !!sources.data?.some((s) => s.kind === 'sitemap'),
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc('site_page_stats', { p_knowledge_base: kb.id })) as { parent_id: string; pages: number; ready: number; busy: number; chunks: number }[]
      return new Map(rows.map((r) => [r.parent_id, { pages: r.pages, ready: r.ready, busy: r.busy, chunks: Number(r.chunks) }]))
    },
  })

  const update = useMutation({
    mutationFn: async ({ ids, patch }: { ids: string[]; patch: Partial<Source> }) => unwrap(await supabase.from('sources').update(patch).in('id', ids)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources', kb.id] })
      qc.invalidateQueries({ queryKey: ['kb-stats', workspace.id] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('sources').delete().eq('id', id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources', kb.id] })
      qc.invalidateQueries({ queryKey: ['kb-stats', workspace.id] })
      toast.success('Source deleted.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const all = useMemo(() => sources.data ?? [], [sources.data])
  const counts = useMemo(() => {
    const c = { all: all.length, ready: 0, busy: 0, failed: 0, disabled: 0, chunks: 0, tokens: 0 }
    for (const s of all) {
      if (s.status === 'ready') c.ready++
      else if (s.status === 'failed') c.failed++
      else if (s.status === 'disabled') c.disabled++
      else c.busy++
      c.chunks += s.chunk_count
      c.tokens += s.token_count
    }
    for (const v of childStats.data?.values() ?? []) c.chunks += v.chunks
    return c
  }, [all, childStats.data])

  const shown = all.filter((s) => {
    if (status === 'busy' ? !(s.status === 'queued' || s.status === 'processing') : status !== 'all' && s.status !== status) return false
    if (kind && s.kind !== kind) return false
    if (q) {
      const t = q.toLowerCase()
      return [s.title, s.url, s.citation, s.question].some((v) => v?.toLowerCase().includes(t))
    }
    return true
  })

  if (sources.isLoading) return <Loading />
  if (sources.error) return <ErrorBox error={sources.error} />
  if (!all.length) {
    return (
      <Card>
        <Empty
          icon={<BookOpen />}
          title="Add your first source"
          description={kb.legal ? 'Upload Acts, regulations and guidance as PDF or Word, or link to an official legal portal.' : 'Upload documents, link your help centre, or paste text and Q&A.'}
          action={can('editor') && <Button variant="primary" icon={<Plus />} onClick={onAdd}>Add sources</Button>}
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sources" value={num(counts.all)} sub={`${counts.ready} ready`} />
        <Stat label="Passages" value={compact(counts.chunks)} sub="Searchable pieces" />
        <Stat label="Tokens" value={compact(counts.tokens)} sub={kb.embedding_model} />
        <Stat
          label="Indexing"
          value={counts.busy ? <span className="inline-flex items-center gap-2">{counts.busy}<Spinner /></span> : 'Up to date'}
          sub={counts.failed ? <span className="text-danger">{counts.failed} failed</span> : 'No errors'}
        />
      </div>

      {counts.failed > 0 && can('editor') && (
        <Notice tone="danger" title={`${counts.failed} source${counts.failed > 1 ? 's' : ''} could not be indexed`}>
          Open one to see why.{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => update.mutate({ ids: all.filter((s) => s.status === 'failed').map((s) => s.id), patch: { status: 'queued' } }, { onSuccess: () => toast.success('Retrying.') })}
          >
            Retry all
          </button>
        </Notice>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sources" className="pl-9" aria-label="Search sources" />
          </div>
          <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as SourceKind | '')} className="w-auto">
            <option value="">All types</option>
            {(Object.keys(KIND_INFO) as SourceKind[]).map((k) => <option key={k} value={k}>{KIND_INFO[k].label}</option>)}
          </Select>
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All' },
              { value: 'ready', label: `Ready ${counts.ready}` },
              { value: 'busy', label: `Indexing ${counts.busy}` },
              { value: 'failed', label: `Failed ${counts.failed}` },
              { value: 'disabled', label: 'Disabled' },
            ]}
          />
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 font-medium">Source</th>
                {kb.legal && <th className="px-3 py-2.5 font-medium">Legal</th>}
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Passages</th>
                <th className="px-3 py-2.5 font-medium">Updated</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((s) => {
                const child = childStats.data?.get(s.id)
                return (
                  <tr key={s.id} className={cn('cursor-pointer hover:bg-surface-2/60', s.superseded && 'opacity-60')} onClick={() => setOpen(s.id)}>
                    <td className="max-w-[420px] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <KindIcon kind={s.kind} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.title || s.url || 'Untitled'}</p>
                          <p className="truncate text-xs text-muted">
                            {s.kind === 'qa' ? 'Q&A' : s.url ? s.url.replace(/^https?:\/\//, '') : KIND_INFO[s.kind].label}
                            {s.kind === 'sitemap' && child ? ` · ${child.ready}/${child.pages} pages` : ''}
                            {s.refresh_hours ? ' · auto-refresh' : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    {kb.legal && (
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {s.jurisdiction && <Badge>{s.jurisdiction}</Badge>}
                          {s.source_type && <span className="text-xs text-muted">{SOURCE_TYPE_LABEL[s.source_type]}</span>}
                          {s.superseded && <Badge tone="warning">Superseded</Badge>}
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-3">
                      {s.kind === 'sitemap' && child?.busy && s.status === 'ready'
                        ? <Badge tone="info"><Spinner className="size-3 text-info" />{child.busy} pages left</Badge>
                        : <StatusBadge source={s} />}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{num(s.kind === 'sitemap' ? child?.chunks ?? 0 : s.chunk_count)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted">{timeAgo(s.last_indexed_at ?? s.updated_at)}</td>
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      {can('editor') && (
                        <Menu>
                          <MenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.title}`}><MoreHorizontal /></Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem icon={<RefreshCw />} onSelect={() => update.mutate({ ids: [s.id], patch: { status: 'queued' } })}>Re-index</MenuItem>
                            {s.status === 'disabled'
                              ? <MenuItem icon={<Play />} onSelect={() => update.mutate({ ids: [s.id], patch: { status: 'queued' } })}>Enable</MenuItem>
                              : <MenuItem icon={<Pause />} onSelect={() => update.mutate({ ids: [s.id], patch: { status: 'disabled' } })}>Disable</MenuItem>}
                            <MenuSeparator />
                            <MenuItem danger icon={<Trash2 />} onSelect={async () => {
                              if (await confirm(`Delete “${s.title}”?`, { body: 'Its passages are deleted and the bot stops using it right away.' })) remove.mutate(s.id)
                            }}>Delete</MenuItem>
                          </MenuContent>
                        </Menu>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!shown.length && <p className="py-10 text-center text-sm text-muted">No sources match.</p>}
        </div>
      </Card>
      <SourceDrawer kb={kb} sourceId={open} onClose={() => setOpen(null)} />
      {element}
    </div>
  )
}

// ── Test search ───────────────────────────────────────────────────────────

interface SearchHit {
  chunk_id: string
  source_id: string
  title: string
  section: string | null
  heading: string
  citation: string | null
  url: string | null
  jurisdiction: string | null
  content: string
  vector_score: number | null
  text_score: number | null
  score: number
}

function SearchTab({ kb }: { kb: KnowledgeBase }) {
  const { workspace } = useWorkspace()
  const [query, setQuery] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const search = useMutation({
    mutationFn: () => admin<{ results: SearchHit[]; took_ms: number }>('/search', { json: { knowledge_base_id: kb.id, query, jurisdiction: jurisdiction || undefined, top_k: 10 } }),
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim()) search.mutate()
          }}
        >
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask a question the way a customer would" className="pl-9" aria-label="Search query" />
          </div>
          {kb.legal && (
            <Select aria-label="Jurisdiction" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className="w-auto">
              <option value="">Any jurisdiction</option>
              {(workspace.settings.jurisdictions ?? []).map((j) => <option key={j} value={j}>{j}</option>)}
            </Select>
          )}
          <Button type="submit" variant="primary" loading={search.isPending} disabled={!query.trim()}>Search</Button>
        </form>
        <p className="mt-2 text-xs text-muted">
          Shows the passages the bot would consider, ranked by meaning and keyword match together. No answer is written.
        </p>
      </Card>

      {search.data && (
        <Card>
          <CardHeader title={`${search.data.results.length} passages`} description={`${search.data.took_ms} ms`} />
          {!search.data.results.length ? (
            <Empty icon={<Search />} title="Nothing found" description="Nothing in this knowledge base matches. Try other words, or add a source that covers it." />
          ) : (
            <ol className="flex flex-col divide-y divide-border border-t border-border">
              {search.data.results.map((r, i) => (
                <li key={r.chunk_id} className="flex gap-4 px-5 py-4">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-xs font-semibold text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className="truncate text-left font-medium hover:underline" onClick={() => setOpen(r.source_id)}>{r.citation || r.title}</button>
                      {r.section && <Badge tone="primary">{r.section}</Badge>}
                      {r.jurisdiction && <Badge>{r.jurisdiction}</Badge>}
                    </div>
                    {r.heading && <p className="mt-0.5 truncate text-xs text-muted">{r.heading}</p>}
                    <p className="mt-2 line-clamp-4 text-[13px] whitespace-pre-wrap text-fg/85">{r.content}</p>
                  </div>
                  <div className="hidden w-28 shrink-0 flex-col gap-1.5 text-[11px] text-muted sm:flex">
                    <Score label="Meaning" v={r.vector_score} />
                    <Score label="Keywords" v={r.text_score} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
      <SourceDrawer kb={kb} sourceId={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function Score({ label, v }: { label: string; v: number | null }) {
  return (
    <div>
      <div className="flex justify-between"><span>{label}</span><span className="tabular-nums">{v == null ? '—' : v.toFixed(2)}</span></div>
      <div className="mt-0.5 h-1 rounded-full bg-surface-3"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(0, Math.min(1, v ?? 0)) * 100}%` }} /></div>
    </div>
  )
}

// ── Settings ──────────────────────────────────────────────────────────────

function SettingsTab({ kb }: { kb: KnowledgeBase }) {
  const { workspace, base, legal, can } = useWorkspace()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { confirm, element } = useConfirm()
  const [d, setD] = useState(kb)
  const reindex = d.embedding_model !== kb.embedding_model || d.embedding_provider !== kb.embedding_provider || d.chunk_tokens !== kb.chunk_tokens || d.chunk_overlap !== kb.chunk_overlap
  const dirty = reindex || d.name !== kb.name || d.description !== kb.description || d.legal !== kb.legal

  const save = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('knowledge_bases').update({
        name: d.name.trim(), description: d.description, legal: d.legal,
        embedding_provider: d.embedding_provider, embedding_model: d.embedding_model,
        chunk_tokens: d.chunk_tokens, chunk_overlap: d.chunk_overlap,
      }).eq('id', kb.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kbs', workspace.id] })
      qc.invalidateQueries({ queryKey: ['sources', kb.id] })
      toast.success(reindex ? 'Saved. Everything is being re-indexed.' : 'Saved.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('knowledge_bases').delete().eq('id', kb.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kbs', workspace.id] })
      qc.invalidateQueries({ queryKey: ['kb-stats', workspace.id] })
      toast.success('Knowledge base deleted.')
      navigate(`${base}/knowledge`)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader title="General" />
        <div className="flex flex-col gap-4 px-5 pb-5">
          <Field label="Name"><Input value={d.name} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="Description" optional><Textarea rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
          {(legal || kb.legal) && (
            <Switch checked={d.legal} onChange={(v) => setD({ ...d, legal: v })} label="Legal sources" description="Show jurisdiction, document type, citation and in-force date on sources." />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Indexing" description="How sources are split into passages and turned into vectors." />
        <div className="flex flex-col gap-4 px-5 pb-5">
          <EmbeddingSelect value={`${d.embedding_provider}:${d.embedding_model}`} legal={d.legal} onChange={(provider, model) => setD({ ...d, embedding_provider: provider, embedding_model: model })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Passage size" hint="In tokens (about ¾ of a word each). Smaller passages are more precise; larger keep more context.">
              <Select value={d.chunk_tokens} onChange={(e) => setD({ ...d, chunk_tokens: Number(e.target.value) })}>
                {[250, 350, 450, 600, 800, 1000].map((n) => <option key={n} value={n}>{n}{n === 450 ? ' (default)' : ''}</option>)}
                {![250, 350, 450, 600, 800, 1000].includes(d.chunk_tokens) && <option value={d.chunk_tokens}>{d.chunk_tokens}</option>}
              </Select>
            </Field>
            <Field label="Overlap" hint="Text repeated between neighbouring passages so nothing is cut mid-thought.">
              <Select value={d.chunk_overlap} onChange={(e) => setD({ ...d, chunk_overlap: Number(e.target.value) })}>
                {[0, 30, 60, 100, 150].map((n) => <option key={n} value={n}>{n}{n === 60 ? ' (default)' : ''}</option>)}
                {![0, 30, 60, 100, 150].includes(d.chunk_overlap) && <option value={d.chunk_overlap}>{d.chunk_overlap}</option>}
              </Select>
            </Field>
          </div>
          {reindex && <Notice tone="warning" title="Saving re-indexes every source">Answers may be less accurate until it finishes, so do this outside busy hours.</Notice>}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" disabled={!dirty || !d.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
      </div>

      {can('editor') && (
        <Card className="border-danger/30">
          <CardHeader
            title="Delete knowledge base"
            description="Deletes every source, file and passage in it. Bots using it stop answering from it."
            actions={<Button variant="danger" icon={<Trash2 />} onClick={async () => {
              if (await confirm(`Delete “${kb.name}”?`, { body: 'All sources, uploaded files and passages are deleted. This cannot be undone.' })) remove.mutate()
            }}>Delete</Button>}
          />
        </Card>
      )}
      {element}
    </div>
  )
}
