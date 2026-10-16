/** Fine-tune jobs with OpenAI or Together AI, started from a dataset. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Info, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, CopyButton, Empty, Loading, Notice, Spinner } from '@/components/ui/display.tsx'
import { Field, Input, Select } from '@/components/ui/form.tsx'
import { Dialog } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { dateTime, num } from '@/lib/format.ts'
import { useModels } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { FinetuneJob } from '@/lib/types.ts'
import { useDatasets, useExampleCounts } from './DatasetsTab.tsx'

const STATUS: Record<FinetuneJob['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  uploading: { label: 'Uploading', tone: 'info' },
  submitted: { label: 'Submitted', tone: 'info' },
  running: { label: 'Training', tone: 'info' },
  succeeded: { label: 'Ready', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    docs: 'https://platform.openai.com/docs/guides/supervised-fine-tuning',
    note: 'OpenAI stopped accepting new fine-tuning customers in May 2026 and stops new jobs on 6 January 2027. Use it only if your organisation still has access.',
  },
  together: {
    label: 'Together AI',
    docs: 'https://docs.together.ai/docs/fine-tuning-overview',
    note: 'LoRA fine-tunes of open models. To serve the result, start a dedicated endpoint for it at Together and add that endpoint as a custom model in Settings → Models.',
  },
} as const

export function FinetuneTab() {
  const { workspace, can, base } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.has('dataset'))
  const datasets = useDatasets()
  const jobs = useQuery({
    queryKey: ['finetunes', workspace.id],
    refetchInterval: (q) => ((q.state.data as FinetuneJob[] | undefined)?.some((j) => !['succeeded', 'failed', 'cancelled'].includes(j.status)) ? 15_000 : false),
    queryFn: async () => unwrap(await supabase.from('finetune_jobs').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: false })) as FinetuneJob[],
  })

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" icon={<Info />} title="Try retrieval and instructions first">
        Fine-tuning teaches a model your tone and format; it does not teach it facts reliably. Facts belong in your knowledge bases, where answers stay cited and up to date. Run an eval before and after to see whether a fine-tune helps.
      </Notice>

      <Card>
        <CardHeader
          title="Fine-tunes"
          description="Training runs on the provider's servers with your own API key."
          actions={can('admin') && <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setOpen(true)}>New fine-tune</Button>}
        />
        {jobs.isLoading ? <Loading /> : !jobs.data?.length ? (
          <Empty icon={<Sparkles />} title="No fine-tunes yet" description="Build a dataset of reviewed examples (50 or more works best), then start a fine-tune here." />
        ) : (
          <div className="scroll-thin overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Base model</th>
                  <th className="px-3 py-2.5 font-medium">Dataset</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Examples</th>
                  <th className="px-3 py-2.5 font-medium">Result</th>
                  <th className="px-3 py-2.5 font-medium">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.data.map((j) => (
                  <tr key={j.id} className="align-top">
                    <td className="px-5 py-3">
                      <p className="font-medium">{j.base_model}</p>
                      <p className="text-xs text-muted">{PROVIDERS[j.provider].label}{j.suffix ? ` · ${j.suffix}` : ''}</p>
                    </td>
                    <td className="px-3 py-3 text-muted">{datasets.data?.find((d) => d.id === j.dataset_id)?.name ?? '—'}</td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS[j.status].tone}>
                        {['uploading', 'submitted', 'running'].includes(j.status) && <Spinner className="size-3 text-info" />}
                        {STATUS[j.status].label}
                      </Badge>
                      {j.error && <p className="mt-1 max-w-xs text-xs text-danger">{j.error}</p>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{num(j.example_count)}</td>
                    <td className="px-3 py-3">
                      {j.result_model ? (
                        <div className="flex items-center gap-1.5">
                          <code className="max-w-[220px] truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{j.result_model}</code>
                          <CopyButton value={j.result_model} size="icon-sm" label="Copy model id" />
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted">{dateTime(j.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {jobs.data?.some((j) => j.status === 'succeeded') && (
          <p className="border-t border-border px-5 py-3 text-[13px] text-muted">
            Finished models appear under “Your models” when you choose a bot's model.{' '}
            {jobs.data.some((j) => j.status === 'succeeded' && j.provider === 'together') && <>Together models need a dedicated endpoint first: add it in <Link className="font-medium text-primary-text underline" to={`${base}/settings/models`}>Settings → Models</Link>.</>}
          </p>
        )}
      </Card>

      <NewFinetuneDialog
        open={open}
        defaultDataset={params.get('dataset')}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v && params.has('dataset')) setParams({}, { replace: true })
        }}
      />
    </div>
  )
}

function NewFinetuneDialog({ open, onOpenChange, defaultDataset }: { open: boolean; onOpenChange: (v: boolean) => void; defaultDataset: string | null }) {
  const { workspace, can, base } = useWorkspace()
  const qc = useQueryClient()
  const datasets = useDatasets()
  const counts = useExampleCounts()
  const models = useModels()
  const [picked, setDataset] = useState('')
  const [provider, setProvider] = useState<'openai' | 'together'>('together')
  const [baseModel, setBaseModel] = useState('')
  const [suffix, setSuffix] = useState('')
  const [epochs, setEpochs] = useState('3')
  const dataset = picked || defaultDataset || datasets.data?.[0]?.id || ''

  const hasKey = models.data?.providers[provider]?.own_key
  const examples = counts.data?.get(dataset)?.approved ?? 0
  const start = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('finetune_jobs').insert({
        workspace_id: workspace.id, dataset_id: dataset, provider, base_model: baseModel.trim(),
        suffix: suffix.trim() || null, hyperparameters: epochs ? { n_epochs: Number(epochs) } : {}, status: 'queued',
      })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finetunes', workspace.id] })
      onOpenChange(false)
      toast.success('Fine-tune queued. It usually takes from 20 minutes to a few hours.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New fine-tune"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!can('admin') || !dataset || !baseModel.trim() || examples < 10 || !hasKey} loading={start.isPending} onClick={() => start.mutate()}>
            Start fine-tune
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dataset" hint={dataset ? `${examples} examples will be used.` : undefined} error={dataset && examples < 10 ? 'At least 10 examples are needed.' : null}>
            <Select value={dataset} onChange={(e) => setDataset(e.target.value)}>
              {datasets.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Provider">
            <Select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
              <option value="together">Together AI</option>
              <option value="openai">OpenAI</option>
            </Select>
          </Field>
        </div>
        <Notice tone={provider === 'openai' ? 'warning' : 'info'}>
          {PROVIDERS[provider].note}{' '}
          <a href={PROVIDERS[provider].docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline">Docs<ExternalLink className="size-3" /></a>
        </Notice>
        {models.data && !hasKey && (
          <Notice tone="danger">
            Fine-tuning needs your own {PROVIDERS[provider].label} key.{' '}
            <Link className="font-medium underline" to={`${base}/settings/models`}>Add one in Settings → Models</Link>.
          </Notice>
        )}
        <Field label="Base model" hint="The exact model id from the provider's list of models that support fine-tuning.">
          <Input value={baseModel} onChange={(e) => setBaseModel(e.target.value)} placeholder={provider === 'openai' ? 'e.g. a gpt-…-mini snapshot' : 'e.g. an Instruct model id from Together'} className="font-mono" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name suffix" optional hint="Added to the new model's name.">
            <Input value={suffix} onChange={(e) => setSuffix(e.target.value.replace(/[^A-Za-z0-9-]/g, ''))} placeholder={workspace.slug.slice(0, 20)} maxLength={40} />
          </Field>
          <Field label="Epochs" hint="Passes over the data. 2–4 is typical.">
            <Select value={epochs} onChange={(e) => setEpochs(e.target.value)}>
              {['1', '2', '3', '4', '5'].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted">Emails and phone numbers are masked before the data leaves BotDesk. Training is billed by the provider.</p>
      </div>
    </Dialog>
  )
}
