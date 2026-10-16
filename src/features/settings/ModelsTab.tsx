/** Provider API keys (stored in Vault) and custom models (fine-tunes, OpenAI-compatible endpoints). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, CheckCircle2, CircleDashed, Cpu, Plus, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, Empty, Loading, Notice } from '@/components/ui/display.tsx'
import { Field, Input, Select } from '@/components/ui/form.tsx'
import { Dialog, useConfirm } from '@/components/ui/overlay.tsx'
import { admin, unwrap } from '@/lib/api.ts'
import { timeAgo } from '@/lib/format.ts'
import { useModels } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { CustomModel, ProviderCredential } from '@/lib/types.ts'

type Provider = ProviderCredential['provider']

const PROVIDERS: { id: Provider; name: string; use: string; keyUrl: string; baseUrl?: 'optional' | 'required' }[] = [
  { id: 'anthropic', name: 'Anthropic', use: 'Claude chat models.', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', name: 'OpenAI', use: 'GPT chat models, embeddings, fine-tuning.', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'voyage', name: 'Voyage AI', use: 'Embeddings, including voyage-law-2 for legal text.', keyUrl: 'https://dashboard.voyageai.com/' },
  { id: 'together', name: 'Together AI', use: 'Open models, fine-tuning and dedicated endpoints.', keyUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'openai_compatible', name: 'OpenAI-compatible', use: 'Any endpoint that speaks the OpenAI chat API: vLLM, Fireworks, OpenRouter, your own server.', keyUrl: '', baseUrl: 'required' },
]

export function ModelsTab() {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const models = useModels()
  const { confirm, element } = useConfirm()
  const [adding, setAdding] = useState<Provider | null>(null)
  const [addingModel, setAddingModel] = useState(false)
  const [tests, setTests] = useState<Record<string, { ok: boolean; detail: string } | 'busy'>>({})

  const creds = useQuery({
    queryKey: ['credentials', workspace.id],
    queryFn: async () => unwrap(await supabase.from('provider_credentials').select('id, provider, label, base_url, key_hint, created_at').eq('workspace_id', workspace.id).order('created_at')) as ProviderCredential[],
  })
  const custom = useQuery({
    queryKey: ['custom-models', workspace.id],
    queryFn: async () => unwrap(await supabase.from('custom_models').select('*').eq('workspace_id', workspace.id).order('created_at')) as CustomModel[],
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['credentials', workspace.id] })
    qc.invalidateQueries({ queryKey: ['custom-models', workspace.id] })
    qc.invalidateQueries({ queryKey: ['models', workspace.id] })
  }
  const removeCred = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('provider_credentials').delete().eq('id', id)),
    onSuccess: () => {
      refresh()
      toast.success('Key deleted.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const removeModel = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('custom_models').delete().eq('id', id)),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  })
  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: 'busy' }))
    try {
      const r = await admin<{ ok: boolean; detail: string }>(`/credentials/${id}/test`, { json: { workspace_id: workspace.id } })
      setTests((t) => ({ ...t, [id]: r }))
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, detail: (e as Error).message } }))
    }
  }

  const status = models.data?.providers ?? {}
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {models.data?.fake_ai && (
        <Notice tone="warning" title="Fake AI is on">This server runs with BOTDESK_FAKE_AI=1, so every answer and embedding comes from a test model. Turn it off in production.</Notice>
      )}
      <Card>
        <CardHeader title="Provider keys" description="Keys are encrypted in Vault and only used on the server. Your own key is always used before BotDesk's." />
        {creds.isLoading ? <Loading /> : (
          <ul className="divide-y divide-border border-t border-border">
            {PROVIDERS.map((p) => {
              const mine = (creds.data ?? []).filter((c) => c.provider === p.id)
              const st = status[p.id]
              return (
                <li key={p.id} className="flex flex-col gap-3 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"><Cpu className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{p.name}</p>
                        {mine.length ? <Badge tone="success">Your key</Badge> : st?.platform ? <Badge tone="info">BotDesk key</Badge> : <Badge>Not set up</Badge>}
                      </div>
                      <p className="text-[13px] text-muted">{p.use}</p>
                    </div>
                    <Button size="sm" icon={<Plus />} onClick={() => setAdding(p.id)}>{mine.length && p.id !== 'openai_compatible' ? 'Replace' : 'Add key'}</Button>
                  </div>
                  {mine.map((c) => {
                    const t = tests[c.id]
                    return (
                      <div key={c.id} className="ml-12 flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2 text-[13px]">
                        <code className="font-mono text-xs">{c.key_hint ?? '…'}</code>
                        <span className="text-muted">{c.label}{c.base_url ? ` · ${c.base_url}` : ''} · added {timeAgo(c.created_at)}</span>
                        {t && t !== 'busy' && (
                          <span className={t.ok ? 'inline-flex items-center gap-1 text-success' : 'inline-flex max-w-full items-center gap-1 truncate text-danger'} title={t.detail}>
                            {t.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{t.ok ? 'Works' : t.detail}
                          </span>
                        )}
                        <div className="ml-auto flex gap-1">
                          <Button size="sm" variant="ghost" loading={t === 'busy'} icon={<CircleDashed />} onClick={() => test(c.id)}>Test</Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Delete key" onClick={async () => {
                            if (await confirm(`Delete this ${p.name} key?`, { body: st?.platform ? 'Bots fall back to BotDesk’s key where your plan allows it.' : 'Bots and knowledge bases using this provider stop working until you add a key.' })) removeCred.mutate(c.id)
                          }}><Trash2 /></Button>
                        </div>
                      </div>
                    )
                  })}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Your models"
          description="Fine-tuned models appear here automatically. Add any model served by Together or an OpenAI-compatible endpoint to use it in a bot."
          actions={<Button size="sm" icon={<Plus />} onClick={() => setAddingModel(true)}>Add model</Button>}
        />
        {custom.isLoading ? <Loading /> : !custom.data?.length ? (
          <Empty icon={<Boxes />} title="No custom models" description="Built-in Claude and GPT models are always available once a key is set up." />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {custom.data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.label}</p>
                  <p className="truncate font-mono text-xs text-muted">{m.model}</p>
                </div>
                <Badge>{PROVIDERS.find((p) => p.id === m.provider)?.name ?? m.provider}</Badge>
                {m.origin === 'finetune' && <Badge tone="primary">Fine-tune</Badge>}
                <Button size="icon-sm" variant="ghost" aria-label="Remove model" onClick={async () => {
                  if (await confirm(`Remove ${m.label}?`, { action: 'Remove', body: 'Bots using it stop answering until you pick another model.' })) removeModel.mutate(m.id)
                }}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <KeyDialog provider={adding} onClose={() => setAdding(null)} onSaved={refresh} />
      <ModelDialog open={addingModel} onOpenChange={setAddingModel} credentials={creds.data ?? []} onSaved={refresh} />
      {element}
    </div>
  )
}

function KeyDialog({ provider, onClose, onSaved }: { provider: Provider | null; onClose: () => void; onSaved: () => void }) {
  const { workspace } = useWorkspace()
  const info = PROVIDERS.find((p) => p.id === provider)
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const save = useMutation({
    mutationFn: () =>
      admin<{ credential: ProviderCredential }>('/credentials', {
        json: { workspace_id: workspace.id, provider, api_key: key.trim(), label: label.trim() || 'default', base_url: baseUrl.trim() || undefined },
      }),
    onSuccess: () => {
      onSaved()
      toast.success('Key saved.')
      setKey('')
      setLabel('')
      setBaseUrl('')
      onClose()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog
      open={!!provider}
      onOpenChange={(v) => !v && onClose()}
      title={`${info?.name ?? ''} key`}
      description={info?.keyUrl ? <>Create one at <a className="underline" href={info.keyUrl} target="_blank" rel="noreferrer">{new URL(info.keyUrl).host}</a>.</> : 'The key your endpoint expects as a Bearer token.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={key.trim().length < 8 || (info?.baseUrl === 'required' && !baseUrl.trim())} loading={save.isPending} onClick={() => save.mutate()}>Save key</Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="API key"><Input autoFocus type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" /></Field>
        {provider === 'openai_compatible' && (
          <>
            <Field label="Base URL" hint="Up to /v1, e.g. https://api.fireworks.ai/inference/v1">
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" inputMode="url" />
            </Field>
            <Field label="Name" hint="To tell several endpoints apart."><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="default" /></Field>
          </>
        )}
        <p className="text-xs text-muted">Saving replaces any key with the same name for this provider. The key can't be read back, only replaced.</p>
      </form>
    </Dialog>
  )
}

function ModelDialog({ open, onOpenChange, credentials, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; credentials: ProviderCredential[]; onSaved: () => void }) {
  const { workspace } = useWorkspace()
  const [provider, setProvider] = useState<CustomModel['provider']>('together')
  const [model, setModel] = useState('')
  const [label, setLabel] = useState('')
  const [cred, setCred] = useState('')
  const usable = credentials.filter((c) => c.provider === provider)
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('custom_models').insert({
        workspace_id: workspace.id, provider, model: model.trim(), label: label.trim() || model.trim(),
        credential_id: cred || usable[0]?.id || null, origin: 'custom',
      })),
    onSuccess: () => {
      onSaved()
      toast.success('Model added. Choose it in a bot’s setup.')
      setModel('')
      setLabel('')
      onOpenChange(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a model"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!model.trim() || !usable.length} loading={save.isPending} onClick={() => save.mutate()}>Add</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Served by">
          <Select value={provider} onChange={(e) => { setProvider(e.target.value as CustomModel['provider']); setCred('') }}>
            <option value="together">Together AI (serverless or dedicated endpoint)</option>
            <option value="openai_compatible">OpenAI-compatible endpoint</option>
            <option value="openai">OpenAI (e.g. a fine-tuned model)</option>
          </Select>
        </Field>
        {!usable.length ? (
          <Notice tone="warning">Add a {PROVIDERS.find((p) => p.id === provider)?.name} key above first.</Notice>
        ) : usable.length > 1 && (
          <Field label="Endpoint / key">
            <Select value={cred} onChange={(e) => setCred(e.target.value)}>
              {usable.map((c) => <option key={c.id} value={c.id}>{c.label}{c.base_url ? ` · ${c.base_url}` : ''}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Model id" hint={provider === 'together' ? 'For a fine-tune, the dedicated endpoint’s model name.' : 'Exactly as the endpoint expects it.'}>
          <Input value={model} onChange={(e) => setModel(e.target.value)} className="font-mono" placeholder="org/model-name" />
        </Field>
        <Field label="Display name" optional><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Legal tuned (Llama)" /></Field>
      </div>
    </Dialog>
  )
}
