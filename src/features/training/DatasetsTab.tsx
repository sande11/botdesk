/** Training datasets: collected from reviewed answers and thumbs-up, editable, exportable as JSONL. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Download, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, Empty, Loading, Notice } from '@/components/ui/display.tsx'
import { Checkbox, Field, Input, Switch, Textarea } from '@/components/ui/form.tsx'
import { Dialog, useConfirm } from '@/components/ui/overlay.tsx'
import { adminDownload, unwrap } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { num, timeAgo } from '@/lib/format.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { Dataset, DatasetExample } from '@/lib/types.ts'

const MIN_EXAMPLES = 10

export function useDatasets() {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['datasets', workspace.id],
    queryFn: async () => unwrap(await supabase.from('datasets').select('*').eq('workspace_id', workspace.id).order('created_at')) as Dataset[],
  })
}

export function useExampleCounts() {
  const { workspace } = useWorkspace()
  return useQuery({
    queryKey: ['dataset-counts', workspace.id],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('dataset_examples').select('dataset_id, approved').eq('workspace_id', workspace.id)) as { dataset_id: string; approved: boolean }[]
      const m = new Map<string, { total: number; approved: number }>()
      for (const r of rows) {
        const c = m.get(r.dataset_id) ?? { total: 0, approved: 0 }
        c.total++
        if (r.approved) c.approved++
        m.set(r.dataset_id, c)
      }
      return m
    },
  })
}

export function DatasetsTab() {
  const { can, legal } = useWorkspace()
  const datasets = useDatasets()
  const counts = useExampleCounts()
  const [chosen, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const selected = datasets.data?.some((d) => d.id === chosen) ? chosen : datasets.data?.[0]?.id ?? null
  const current = datasets.data?.find((d) => d.id === selected)

  if (datasets.isLoading) return <Loading />
  if (!datasets.data?.length) {
    return (
      <Card>
        <Empty
          icon={<Database />}
          title="No datasets yet"
          description={`A dataset holds question-and-answer examples in your ${legal ? 'reviewers’' : 'team’s'} preferred style. Collect them from reviewed answers, then export or fine-tune.`}
          action={can('editor') && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New dataset</Button>}
        />
        <CreateDatasetDialog open={creating} onOpenChange={setCreating} onCreated={setSelected} />
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        {datasets.data.map((d) => {
          const c = counts.data?.get(d.id)
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelected(d.id)}
              className={cn('flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors', d.id === selected ? 'border-primary bg-primary-soft/50' : 'border-border bg-surface hover:border-border-strong')}
            >
              <span className="truncate font-medium">{d.name}</span>
              <span className="text-xs text-muted">{num(c?.approved ?? 0)} example{c?.approved === 1 ? '' : 's'} · {timeAgo(d.created_at)}</span>
            </button>
          )
        })}
        {can('editor') && <Button variant="ghost" icon={<Plus />} className="justify-start" onClick={() => setCreating(true)}>New dataset</Button>}
      </div>
      {current && <DatasetDetail key={current.id} dataset={current} onDeleted={() => setSelected(null)} />}
      <CreateDatasetDialog open={creating} onOpenChange={setCreating} onCreated={setSelected} />
    </div>
  )
}

function DatasetDetail({ dataset, onDeleted }: { dataset: Dataset; onDeleted: () => void }) {
  const { workspace, base, can } = useWorkspace()
  const qc = useQueryClient()
  const { confirm, element } = useConfirm()
  const [positive, setPositive] = useState(true)
  const [adding, setAdding] = useState(false)
  const [prompt, setPrompt] = useState(dataset.system_prompt)
  const examples = useQuery({
    queryKey: ['dataset-examples', dataset.id],
    queryFn: async () =>
      unwrap(await supabase.from('dataset_examples').select('*').eq('dataset_id', dataset.id).order('created_at', { ascending: false }).limit(500)) as DatasetExample[],
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dataset-examples', dataset.id] })
    qc.invalidateQueries({ queryKey: ['dataset-counts', workspace.id] })
  }
  const collect = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('collect_examples', { p_dataset: dataset.id, p_include_positive: positive })) as number,
    onSuccess: (n) => {
      refresh()
      toast.success(n ? `Added ${n} example${n > 1 ? 's' : ''}.` : 'No new examples to add.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const toggle = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) => unwrap(await supabase.from('dataset_examples').update({ approved }).eq('id', id)),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  })
  const removeExample = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('dataset_examples').delete().eq('id', id)),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  })
  const savePrompt = useMutation({
    mutationFn: async () => unwrap(await supabase.from('datasets').update({ system_prompt: prompt }).eq('id', dataset.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets', workspace.id] })
      toast.success('Saved.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('datasets').delete().eq('id', dataset.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets', workspace.id] })
      refresh()
      onDeleted()
      toast.success('Dataset deleted.')
    },
    onError: (e) => toast.error(/restrict|foreign key|refers/i.test((e as Error).message) ? 'A fine-tune used this dataset, so it is kept.' : (e as Error).message),
  })
  const exportFile = async () => {
    try {
      const n = await adminDownload(`/datasets/${dataset.id}/export`, `${dataset.name.replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase() || 'dataset'}.jsonl`)
      toast.success(`Exported ${n} examples. Emails and phone numbers were masked.`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const approved = examples.data?.filter((e) => e.approved).length ?? 0
  const editor = can('editor')

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader
          title={dataset.name}
          description={dataset.description || `${num(approved)} of ${num(examples.data?.length ?? 0)} example${examples.data?.length === 1 ? ' is' : 's are'} used in exports and fine-tunes.`}
          actions={
            <>
              <Button size="sm" icon={<Download />} onClick={exportFile} disabled={!approved}>Export JSONL</Button>
              {editor && (
                <Link to={`${base}/training/finetune?dataset=${dataset.id}`}>
                  <Button size="sm" variant="primary" icon={<Sparkles />} disabled={approved < MIN_EXAMPLES}>Fine-tune</Button>
                </Link>
              )}
            </>
          }
        />
        {editor && (
          <div className="flex flex-col gap-4 border-t border-border px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button icon={<Wand2 />} loading={collect.isPending} onClick={() => collect.mutate()}>Collect examples</Button>
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <Switch checked={positive} onChange={setPositive} />
                Also add answers customers rated helpful
              </label>
            </div>
            {approved < MIN_EXAMPLES && (
              <Notice tone="info">
                Fine-tuning needs at least {MIN_EXAMPLES} examples; 50 to 100 well-reviewed ones give much better results. Most quality problems are solved faster by adding sources or editing the bot's instructions.
              </Notice>
            )}
            <Field label="System prompt for training" hint="Sent as the first message of every example. Keep it close to the bot's instructions.">
              <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </Field>
            <div className="flex justify-between">
              <Button variant="danger-ghost" size="sm" icon={<Trash2 />} onClick={async () => {
                if (await confirm(`Delete “${dataset.name}”?`, { body: 'Its examples are deleted. Reviewed answers stay in the review queue.' })) remove.mutate()
              }}>Delete dataset</Button>
              <Button size="sm" disabled={prompt === dataset.system_prompt} loading={savePrompt.isPending} onClick={() => savePrompt.mutate()}>Save prompt</Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Examples"
          description="Untick an example to leave it out without deleting it."
          actions={editor && <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>Add example</Button>}
        />
        {examples.isLoading ? <Loading /> : !examples.data?.length ? (
          <Empty icon={<Database />} title="No examples yet" description="Approve or correct answers in Review, then collect them here." />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {examples.data.map((ex) => {
              const user = ex.messages.find((m) => m.role === 'user')?.content ?? ''
              const bot = ex.messages.find((m) => m.role === 'assistant')?.content ?? ''
              return (
                <li key={ex.id} className={cn('flex gap-3 px-5 py-3', !ex.approved && 'opacity-55')}>
                  <input
                    type="checkbox"
                    aria-label="Use this example"
                    className="mt-1 size-4 accent-[var(--primary)]"
                    checked={ex.approved}
                    disabled={!editor}
                    onChange={(e) => toggle.mutate({ id: ex.id, approved: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{user}</p>
                    <p className="mt-1 line-clamp-3 text-[13px] whitespace-pre-wrap text-muted">{bot}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={ex.origin === 'review' ? 'info' : ex.origin === 'feedback' ? 'success' : 'neutral'}>{ex.origin}</Badge>
                    {editor && (
                      <button type="button" aria-label="Delete example" className="text-subtle hover:text-danger" onClick={() => removeExample.mutate(ex.id)}>
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <AddExampleDialog dataset={dataset} open={adding} onOpenChange={setAdding} onAdded={refresh} />
      {element}
    </div>
  )
}

function CreateDatasetDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const { workspace, legal } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState(
    legal
      ? 'You are a legal information assistant. Answer in plain language from the law of the stated jurisdiction, cite the section you rely on, and say when the person should see a lawyer.'
      : 'You are a helpful support assistant. Answer briefly and accurately in a friendly tone.',
  )
  const [seed, setSeed] = useState(true)
  const create = useMutation({
    mutationFn: async () => {
      const ds = unwrap(await supabase.from('datasets').insert({ workspace_id: workspace.id, name: name.trim(), description: description.trim(), system_prompt: prompt }).select('id').single()) as { id: string }
      let added = 0
      if (seed) added = (unwrap(await supabase.rpc('collect_examples', { p_dataset: ds.id, p_include_positive: true })) as number) ?? 0
      return { id: ds.id, added }
    },
    onSuccess: ({ id, added }) => {
      qc.invalidateQueries({ queryKey: ['datasets', workspace.id] })
      qc.invalidateQueries({ queryKey: ['dataset-counts', workspace.id] })
      onCreated(id)
      onOpenChange(false)
      setName('')
      toast.success(seed ? `Dataset created with ${added} example${added === 1 ? '' : 's'}.` : 'Dataset created.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New dataset"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Create</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={legal ? 'Reviewed legal answers' : 'Support answers'} /></Field>
        <Field label="Description" optional><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="System prompt" hint="Used as the first message of every training example."><Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
        <Checkbox checked={seed} onChange={setSeed} label="Start with what you have" description="Adds every approved or corrected review, and answers customers rated helpful." />
      </div>
    </Dialog>
  )
}

function AddExampleDialog({ dataset, open, onOpenChange, onAdded }: { dataset: Dataset; open: boolean; onOpenChange: (v: boolean) => void; onAdded: () => void }) {
  const { workspace } = useWorkspace()
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const add = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('dataset_examples').insert({
        workspace_id: workspace.id, dataset_id: dataset.id, origin: 'manual', approved: true,
        messages: [{ role: 'user', content: q.trim() }, { role: 'assistant', content: a.trim() }],
      })),
    onSuccess: () => {
      onAdded()
      setQ('')
      setA('')
      onOpenChange(false)
      toast.success('Example added.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add an example"
      description="Write a question and the ideal answer."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!q.trim() || !a.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Question"><Textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="Ideal answer"><Textarea rows={6} value={a} onChange={(e) => setA(e.target.value)} /></Field>
      </div>
    </Dialog>
  )
}
