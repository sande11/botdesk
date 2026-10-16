/**
 * Eval sets: questions with the answer a good bot should give (or should
 * decline). Each run answers every case with a bot (optionally another
 * model) and grades it, so changes can be compared before going live.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Download, FlaskConical, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Markdown } from '@/components/MessageView.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, Empty, Loading, Notice, Spinner } from '@/components/ui/display.tsx'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form.tsx'
import { Dialog, Tip, useConfirm } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { dateTime, pct } from '@/lib/format.ts'
import { useBots, useModels } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { EvalCase, EvalResult, EvalRun, EvalSet, ReviewItem } from '@/lib/types.ts'

const METRICS: { key: keyof EvalRun['metrics']; label: string; hint: string; format: (v: number | null | undefined) => string }[] = [
  { key: 'answered_rate', label: 'Answered', hint: 'Share of questions the bot answered rather than saying it does not know.', format: (v) => pct(v) },
  { key: 'correctness', label: 'Correct', hint: 'How well answers match the expected answer, graded by a model (0–100%).', format: (v) => pct(v) },
  { key: 'faithfulness', label: 'Grounded', hint: 'How much of each answer is supported by the passages it cites.', format: (v) => pct(v) },
  { key: 'citation_rate', label: 'Cited', hint: 'Answered questions that cite at least one source.', format: (v) => pct(v) },
  { key: 'source_recall', label: 'Right source', hint: 'Cases with expected sources where at least one of them was found.', format: (v) => pct(v) },
  { key: 'avg_latency_ms', label: 'Avg time', hint: 'Average time to answer.', format: (v) => (v == null ? '—' : `${(v / 1000).toFixed(1)}s`) },
]

function useEvalSets() {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['eval-sets', workspace.id],
    queryFn: async () => unwrap(await supabase.from('eval_sets').select('*').eq('workspace_id', workspace.id).order('created_at')) as EvalSet[],
  })
}

export function EvalsTab() {
  const { can } = useWorkspace()
  const sets = useEvalSets()
  const [chosen, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const selected = sets.data?.some((s) => s.id === chosen) ? chosen : sets.data?.[0]?.id ?? null
  const current = sets.data?.find((s) => s.id === selected)

  if (sets.isLoading) return <Loading />
  if (!sets.data?.length) {
    return (
      <Card>
        <Empty
          icon={<FlaskConical />}
          title="Measure your bot before you change it"
          description="An eval set is a list of real questions with what a good answer must say. Run it after changing sources, instructions or the model, and compare the scores."
          action={can('editor') && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New eval set</Button>}
        />
        <CreateSetDialog open={creating} onOpenChange={setCreating} onCreated={setSelected} />
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        {sets.data.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelected(s.id)}
            className={cn('flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors', s.id === selected ? 'border-primary bg-primary-soft/50' : 'border-border bg-surface hover:border-border-strong')}
          >
            <span className="truncate font-medium">{s.name}</span>
            {s.description && <span className="line-clamp-1 text-xs text-muted">{s.description}</span>}
          </button>
        ))}
        {can('editor') && <Button variant="ghost" icon={<Plus />} className="justify-start" onClick={() => setCreating(true)}>New eval set</Button>}
      </div>
      {current && <SetDetail key={current.id} set={current} onDeleted={() => setSelected(null)} />}
      <CreateSetDialog open={creating} onOpenChange={setCreating} onCreated={setSelected} />
    </div>
  )
}

function SetDetail({ set, onDeleted }: { set: EvalSet; onDeleted: () => void }) {
  const { workspace, can } = useWorkspace()
  const qc = useQueryClient()
  const bots = useBots()
  const { confirm, element } = useConfirm()
  const [editing, setEditing] = useState<EvalCase | 'new' | null>(null)
  const [running, setRunning] = useState(false)
  const [viewRun, setViewRun] = useState<EvalRun | null>(null)

  const cases = useQuery({
    queryKey: ['eval-cases', set.id],
    queryFn: async () => unwrap(await supabase.from('eval_cases').select('*').eq('eval_set_id', set.id).order('created_at')) as EvalCase[],
  })
  const runs = useQuery({
    queryKey: ['eval-runs', set.id],
    refetchInterval: (q) => ((q.state.data as EvalRun[] | undefined)?.some((r) => r.status === 'queued' || r.status === 'running') ? 4000 : false),
    queryFn: async () => unwrap(await supabase.from('eval_runs').select('*').eq('eval_set_id', set.id).order('created_at', { ascending: false }).limit(30)) as EvalRun[],
  })
  const progress = useQuery({
    queryKey: ['eval-progress', set.id, runs.dataUpdatedAt],
    enabled: !!runs.data?.some((r) => r.status === 'running'),
    queryFn: async () => {
      const active = runs.data!.filter((r) => r.status === 'running')
      const out = new Map<string, number>()
      await Promise.all(active.map(async (r) => {
        const { count } = await supabase.from('eval_results').select('id', { count: 'exact', head: true }).eq('run_id', r.id)
        out.set(r.id, count ?? 0)
      }))
      return out
    },
  })

  const removeCase = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('eval_cases').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eval-cases', set.id] }),
    onError: (e) => toast.error((e as Error).message),
  })
  const importReviews = useMutation({
    mutationFn: async () => {
      const reviewed = unwrap(
        await supabase.from('review_items').select('question, answer, corrected_answer, jurisdiction, status')
          .eq('workspace_id', workspace.id).in('status', ['approved', 'corrected']).order('reviewed_at', { ascending: false }).limit(200),
      ) as Pick<ReviewItem, 'question' | 'answer' | 'corrected_answer' | 'jurisdiction' | 'status'>[]
      const have = new Set((cases.data ?? []).map((c) => c.question.trim().toLowerCase()))
      const rows = reviewed
        .filter((r) => r.question.trim() && !have.has(r.question.trim().toLowerCase()))
        .map((r) => ({
          workspace_id: workspace.id, eval_set_id: set.id, question: r.question.trim(),
          expected_answer: (r.status === 'corrected' ? r.corrected_answer : r.answer) ?? '',
          expected_source_ids: [], should_decline: false, jurisdiction: r.jurisdiction,
        }))
      if (rows.length) unwrap(await supabase.from('eval_cases').insert(rows))
      return rows.length
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['eval-cases', set.id] })
      toast.success(n ? `Added ${n} case${n > 1 ? 's' : ''} from reviewed answers.` : 'No new reviewed answers to add.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const removeSet = useMutation({
    mutationFn: async () => unwrap(await supabase.from('eval_sets').delete().eq('id', set.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eval-sets', workspace.id] })
      onDeleted()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const removeRun = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('eval_runs').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eval-runs', set.id] }),
    onError: (e) => toast.error((e as Error).message),
  })

  const editor = can('editor')
  const n = cases.data?.length ?? 0
  const best = useMemo(() => {
    const done = (runs.data ?? []).filter((r) => r.status === 'done')
    const out: Partial<Record<keyof EvalRun['metrics'], number>> = {}
    for (const m of METRICS) {
      const vals = done.map((r) => r.metrics[m.key]).filter((v): v is number => typeof v === 'number')
      if (vals.length > 1) out[m.key] = m.key === 'avg_latency_ms' ? Math.min(...vals) : Math.max(...vals)
    }
    return out
  }, [runs.data])

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader
          title="Runs"
          description={`${set.name} · ${n} case${n === 1 ? '' : 's'}`}
          actions={editor && <Button variant="primary" size="sm" icon={<Play />} disabled={!n} onClick={() => setRunning(true)}>Run eval</Button>}
        />
        {runs.isLoading ? <Loading /> : !runs.data?.length ? (
          <p className="border-t border-border px-5 py-8 text-center text-sm text-muted">{n ? 'No runs yet. Run the eval to get a baseline.' : 'Add a few cases, then run the eval.'}</p>
        ) : (
          <div className="scroll-thin overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Run</th>
                  {METRICS.map((m) => (
                    <th key={m.key} className="px-3 py-2.5 text-right font-medium">
                      <Tip content={m.hint}><span className="cursor-help border-b border-dotted border-border-strong">{m.label}</span></Tip>
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.data.map((r) => (
                  <tr key={r.id} className={cn(r.status === 'done' && 'cursor-pointer hover:bg-surface-2/60')} onClick={() => r.status === 'done' && setViewRun(r)}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{bots.data?.find((b) => b.id === r.bot_id)?.name ?? 'Bot'}</p>
                      <p className="text-xs text-muted">
                        {r.model_override ? (r.model_override.model || 'custom model') : 'bot model'} · {dateTime(r.created_at)}
                      </p>
                    </td>
                    {r.status === 'done' ? (
                      METRICS.map((m) => {
                        const v = r.metrics[m.key]
                        return (
                          <td key={m.key} className={cn('px-3 py-3 text-right tabular-nums', best[m.key] != null && v === best[m.key] && 'font-semibold text-success')}>
                            {m.format(v)}
                          </td>
                        )
                      })
                    ) : (
                      <td colSpan={METRICS.length} className="px-3 py-3 text-right">
                        {r.status === 'failed' ? (
                          <span className="text-xs text-danger">{r.error ?? 'Failed'}</span>
                        ) : (
                          <Badge tone="info">
                            <Spinner className="size-3 text-info" />
                            {r.status === 'queued' ? 'Queued' : `${progress.data?.get(r.id) ?? 0} of ${r.metrics.cases ?? n}`}
                          </Badge>
                        )}
                      </td>
                    )}
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      {editor && (
                        <Button variant="ghost" size="icon-sm" aria-label="Delete run" onClick={() => removeRun.mutate(r.id)}><Trash2 /></Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Cases"
          description="Questions to ask, and what a good answer must say."
          actions={editor && (
            <>
              <Button size="sm" icon={<Download />} loading={importReviews.isPending} onClick={() => importReviews.mutate()}>From reviews</Button>
              <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>Add case</Button>
            </>
          )}
        />
        {cases.isLoading ? <Loading /> : !n ? (
          <Empty icon={<ClipboardList />} title="No cases yet" description="Add questions your customers really ask, including a few the bot should decline." />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {cases.data!.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.question}</p>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">
                    {c.should_decline ? <i>Should decline: out of scope.</i> : c.expected_answer || <i>No expected answer: only sources and citations are checked.</i>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {c.jurisdiction && <Badge>{c.jurisdiction}</Badge>}
                  {c.expected_source_ids.length > 0 && <Badge tone="info">{c.expected_source_ids.length} source{c.expected_source_ids.length > 1 ? 's' : ''}</Badge>}
                  {editor && (
                    <>
                      <Button variant="ghost" size="icon-sm" aria-label="Edit case" onClick={() => setEditing(c)}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Delete case" onClick={() => removeCase.mutate(c.id)}><Trash2 /></Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {editor && (
          <div className="border-t border-border px-5 py-3">
            <Button variant="danger-ghost" size="sm" icon={<Trash2 />} onClick={async () => {
              if (await confirm(`Delete “${set.name}”?`, { body: 'Its cases and all runs are deleted.' })) removeSet.mutate()
            }}>Delete eval set</Button>
          </div>
        )}
      </Card>

      <CaseDialog key={editing === 'new' ? 'new' : editing?.id ?? 'closed'} set={set} value={editing} onClose={() => setEditing(null)} />
      <RunDialog set={set} open={running} onOpenChange={setRunning} />
      <ResultsDialog run={viewRun} cases={cases.data ?? []} onClose={() => setViewRun(null)} />
      {element}
    </div>
  )
}

function CreateSetDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.from('eval_sets').insert({ workspace_id: workspace.id, name: name.trim(), description: description.trim() }).select('id').single()) as { id: string },
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ['eval-sets', workspace.id] })
      onCreated(id)
      onOpenChange(false)
      setName('')
      setDescription('')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New eval set"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Top 50 questions" /></Field>
        <Field label="Description" optional><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
    </Dialog>
  )
}

function CaseDialog({ set, value, onClose }: { set: EvalSet; value: EvalCase | 'new' | null; onClose: () => void }) {
  const { workspace, legal } = useWorkspace()
  const qc = useQueryClient()
  // The parent remounts this dialog (key) for each case, so state starts from it.
  const existing = value && value !== 'new' ? value : null
  const [question, setQuestion] = useState(existing?.question ?? '')
  const [expected, setExpected] = useState(existing?.expected_answer ?? '')
  const [decline, setDecline] = useState(existing?.should_decline ?? false)
  const [jurisdiction, setJurisdiction] = useState(existing?.jurisdiction ?? '')
  const [sources, setSources] = useState<string[]>(existing?.expected_source_ids ?? [])
  const [filter, setFilter] = useState('')

  const allSources = useQuery({
    queryKey: ['source-titles', workspace.id],
    enabled: !!value,
    queryFn: async () =>
      unwrap(await supabase.from('sources').select('id, title, citation, kind').eq('workspace_id', workspace.id).neq('kind', 'sitemap').order('title').limit(1000)) as { id: string; title: string; citation: string | null; kind: string }[],
  })
  const shown = (allSources.data ?? []).filter((s) => sources.includes(s.id) || !filter || `${s.title} ${s.citation ?? ''}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 60)

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        question: question.trim(), expected_answer: decline ? '' : expected.trim(), should_decline: decline,
        jurisdiction: jurisdiction.trim().toUpperCase() || null, expected_source_ids: decline ? [] : sources,
      }
      if (existing) unwrap(await supabase.from('eval_cases').update(row).eq('id', existing.id))
      else unwrap(await supabase.from('eval_cases').insert({ ...row, workspace_id: workspace.id, eval_set_id: set.id }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eval-cases', set.id] })
      onClose()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={existing ? 'Edit case' : 'Add a case'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!question.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Question"><Textarea autoFocus rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Can my employer dismiss me without notice?" /></Field>
        <Checkbox checked={decline} onChange={setDecline} label="The bot should decline this" description="Out of scope or not in your sources; a good bot says it doesn't know or offers a person." />
        {!decline && (
          <>
            <Field label="A good answer says" optional hint="Key facts, not exact wording. A model grades each answer against this.">
              <Textarea rows={4} value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="No, except for serious misconduct. The employer must give written notice (section 29)." />
            </Field>
            <Field label="Should use these sources" optional>
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter sources" />
              <div className="scroll-thin mt-2 max-h-48 overflow-y-auto rounded-xl border border-border">
                {allSources.isLoading ? <Loading /> : shown.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-surface-2">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={sources.includes(s.id)} onChange={(e) => setSources(e.target.checked ? [...sources, s.id] : sources.filter((x) => x !== s.id))} />
                    <span className="truncate">{s.citation || s.title || 'Untitled'}</span>
                  </label>
                ))}
              </div>
            </Field>
          </>
        )}
        {legal && (
          <Field label="Jurisdiction" optional>
            <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="MW" maxLength={12} className="w-32" />
          </Field>
        )}
      </div>
    </Dialog>
  )
}

function RunDialog({ set, open, onOpenChange }: { set: EvalSet; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const bots = useBots()
  const models = useModels()
  const [picked, setBot] = useState('')
  const [model, setModel] = useState('')
  const bot = picked || bots.data?.[0]?.id || ''
  const run = useMutation({
    mutationFn: async () => {
      const override = model.startsWith('custom:')
        ? { custom_model_id: model.slice(7) }
        : model ? { provider: model.split(':')[0], model: model.split(':').slice(1).join(':') } : null
      unwrap(await supabase.from('eval_runs').insert({ workspace_id: workspace.id, eval_set_id: set.id, bot_id: bot, model_override: override, status: 'queued' }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eval-runs', set.id] })
      onOpenChange(false)
      toast.success('Eval started. Results appear as each case is graded.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const catalog = models.data
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Run eval"
      description="Each case is answered the way a customer would get it, then graded. Nothing is saved to the inbox."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" icon={<Play />} disabled={!bot} loading={run.isPending} onClick={() => run.mutate()}>Run</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Bot">
          <Select value={bot} onChange={(e) => setBot(e.target.value)}>
            {bots.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Model" hint="Compare another model without changing the bot.">
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">The bot's model</option>
            {(['anthropic', 'openai'] as const).map((p) => {
              const list = (catalog?.chat ?? []).filter((m) => m.provider === p && m.available)
              return list.length ? (
                <optgroup key={p} label={p === 'anthropic' ? 'Claude' : 'OpenAI'}>
                  {list.map((m) => <option key={m.id} value={`${m.provider}:${m.id}`}>{m.label}</option>)}
                </optgroup>
              ) : null
            })}
            {!!catalog?.custom.length && (
              <optgroup label="Your models">
                {catalog.custom.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.label}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>
        <Notice tone="info">Grading uses a small model and counts toward your usage.</Notice>
      </div>
    </Dialog>
  )
}

function ResultsDialog({ run, cases, onClose }: { run: EvalRun | null; cases: EvalCase[]; onClose: () => void }) {
  const results = useQuery({
    queryKey: ['eval-results', run?.id],
    enabled: !!run,
    queryFn: async () => unwrap(await supabase.from('eval_results').select('*').eq('run_id', run!.id)) as EvalResult[],
  })
  const [only, setOnly] = useState<'all' | 'weak'>('all')
  const byCase = new Map(cases.map((c) => [c.id, c]))
  const rows = (results.data ?? [])
    .map((r) => ({ r, c: byCase.get(r.case_id) }))
    .filter(({ r, c }) => {
      if (only === 'all') return true
      if (c?.should_decline) return !r.scores.declined
      return (r.scores.correctness ?? 1) < 0.7 || r.scores.source_hit === false || r.outcome !== 'answered'
    })
    .sort((a, b) => (a.r.scores.correctness ?? 1) - (b.r.scores.correctness ?? 1))
  return (
    <Dialog side open={!!run} onOpenChange={(v) => !v && onClose()} title="Eval results" description={run ? dateTime(run.created_at) : undefined}>
      {!run ? null : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            {METRICS.map((m) => (
              <div key={m.key} className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-xs text-muted">{m.label}</p>
                <p className="text-lg font-semibold tabular-nums">{m.format(run.metrics[m.key])}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant={only === 'all' ? 'secondary' : 'ghost'} onClick={() => setOnly('all')}>All</Button>
            <Button size="sm" variant={only === 'weak' ? 'secondary' : 'ghost'} onClick={() => setOnly('weak')}>Needs work</Button>
          </div>
          {results.isLoading ? <Loading /> : !rows.length ? (
            <p className="py-6 text-center text-sm text-muted">Nothing to show.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map(({ r, c }) => <ResultItem key={r.id} r={r} c={c} />)}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  )
}

function ResultItem({ r, c }: { r: EvalResult; c: EvalCase | undefined }) {
  const [open, setOpen] = useState(false)
  const s = r.scores
  const declineOk = c?.should_decline ? !!s.declined : null
  return (
    <li className="rounded-xl border border-border p-3">
      <p className="text-sm font-medium">{c?.question ?? 'Deleted case'}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {declineOk != null ? (
          <Badge tone={declineOk ? 'success' : 'danger'}>{declineOk ? 'Declined correctly' : 'Should have declined'}</Badge>
        ) : (
          <>
            <ScoreBadge label="Correct" v={s.correctness} />
            <ScoreBadge label="Grounded" v={s.faithfulness} />
            {s.source_hit != null && <Badge tone={s.source_hit ? 'success' : 'danger'}>{s.source_hit ? 'Right source' : 'Missed source'}</Badge>}
            {r.outcome === 'no_answer' && <Badge tone="warning">No answer</Badge>}
          </>
        )}
        {r.latency_ms != null && <Badge>{(r.latency_ms / 1000).toFixed(1)}s</Badge>}
      </div>
      {s.notes && <p className="mt-2 text-[13px] text-muted">{s.notes}</p>}
      <button type="button" className="mt-2 text-xs font-medium text-primary-text hover:underline" onClick={() => setOpen(!open)}>{open ? 'Hide answer' : 'Show answer'}</button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <Block label="Answer"><Markdown text={r.answer || '_(none)_'} citations={r.citations.length} /></Block>
          {c?.expected_answer && <Block label="Expected"><p className="text-sm">{c.expected_answer}</p></Block>}
        </div>
      )}
    </li>
  )
}

function ScoreBadge({ label, v }: { label: string; v: number | null | undefined }) {
  if (v == null) return null
  return <Badge tone={v >= 0.8 ? 'success' : v >= 0.5 ? 'warning' : 'danger'}>{label} {pct(v)}</Badge>
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2/70 p-2.5">
      <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</p>
      {children}
    </div>
  )
}
