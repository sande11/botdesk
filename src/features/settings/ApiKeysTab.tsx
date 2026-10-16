import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Globe, KeyRound, Plus, Server } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, CopyButton, Empty, Loading, Notice, Secret, Segmented } from '@/components/ui/display.tsx'
import { Checkbox, Field, Input, Select } from '@/components/ui/form.tsx'
import { Dialog, useConfirm } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { timeAgo } from '@/lib/format.ts'
import { useApiKeys, useBots } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { API_URL, supabase } from '@/lib/supabase.ts'

const SCOPES = [
  { id: 'chat', label: 'Chat', description: 'Ask questions and get answers (/v1/chat).' },
  { id: 'ingest', label: 'Ingest', description: 'Add, update and delete sources (/v1/sources).' },
  { id: 'conversations', label: 'Conversations', description: 'Read conversations, hand off to people, delete contacts.' },
  { id: 'analyze', label: 'Legal analysis', description: 'Listen In: analyze and summarize transcripts (/v1/legal/*).' },
]

export function ApiKeysTab() {
  const { workspace } = useWorkspace()
  const keys = useApiKeys()
  const bots = useBots()
  const qc = useQueryClient()
  const { confirm, element } = useConfirm()
  const [creating, setCreating] = useState(false)
  const [show, setShow] = useState<'active' | 'revoked'>('active')
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-keys', workspace.id] })
      toast.success('Key revoked. Requests using it now fail.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const list = (keys.data ?? []).filter((k) => (show === 'active' ? !k.revoked_at : !!k.revoked_at))

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="flex gap-3 p-4">
          <Globe className="mt-0.5 size-5 shrink-0 text-primary-text" />
          <div className="text-[13px]">
            <p className="font-semibold">Publishable keys <code className="font-mono text-xs text-muted">bd_pk_…</code></p>
            <p className="text-muted">Safe in web pages and mobile apps. Chat only, for one bot, and only from the domains you allow.</p>
          </div>
        </Card>
        <Card className="flex gap-3 p-4">
          <Server className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="text-[13px]">
            <p className="font-semibold">Secret keys <code className="font-mono text-xs text-muted">bd_sk_…</code></p>
            <p className="text-muted">For your servers only: ingest sources, read conversations, legal analysis. Never put one in an app or web page.</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="API keys"
          description={<>Base URL <code className="font-mono">{API_URL}/v1</code></>}
          actions={
            <>
              <Segmented value={show} onChange={setShow} options={[{ value: 'active', label: 'Active' }, { value: 'revoked', label: 'Revoked' }]} />
              <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setCreating(true)}>New key</Button>
            </>
          }
        />
        {keys.isLoading ? <Loading /> : !list.length ? (
          <Empty icon={<KeyRound />} title={show === 'active' ? 'No API keys yet' : 'No revoked keys'} description={show === 'active' ? 'Create a publishable key for the widget or your app, or a secret key for your server.' : undefined} />
        ) : (
          <div className="scroll-thin overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-3 py-2.5 font-medium">Key</th>
                  <th className="px-3 py-2.5 font-medium">Bot</th>
                  <th className="px-3 py-2.5 font-medium">Last used</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((k) => (
                  <tr key={k.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{k.name || 'Untitled'}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={k.kind === 'secret' ? 'warning' : 'info'}>{k.kind}</Badge>
                        {k.kind === 'secret' && k.scopes.map((s) => <Badge key={s}>{s}</Badge>)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono text-xs">{k.display_key ? `${k.display_key.slice(0, 14)}…` : `${k.prefix}…`}</code>
                        {k.display_key && !k.revoked_at && <CopyButton value={k.display_key} size="icon-sm" label="Copy key" />}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted">{k.bot_id ? bots.data?.find((b) => b.id === k.bot_id)?.name ?? '—' : 'Any bot'}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted">{k.revoked_at ? `Revoked ${timeAgo(k.revoked_at)}` : k.last_used_at ? timeAgo(k.last_used_at) : 'Never'}</td>
                    <td className="px-3 py-3 text-right">
                      {!k.revoked_at && (
                        <Button variant="danger-ghost" size="sm" onClick={async () => {
                          if (await confirm(`Revoke “${k.name || k.prefix}”?`, { action: 'Revoke', body: 'Anything using this key stops working immediately. This cannot be undone.' })) revoke.mutate(k.id)
                        }}>Revoke</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <CreateKeyDialog open={creating} onOpenChange={setCreating} />
      {element}
    </div>
  )
}

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspace, legal } = useWorkspace()
  const bots = useBots()
  const qc = useQueryClient()
  const [kind, setKind] = useState<'publishable' | 'secret'>('publishable')
  const [name, setName] = useState('')
  const [bot, setBot] = useState('')
  const [scopes, setScopes] = useState<string[]>(['chat', 'ingest', 'conversations', 'analyze'])
  const [raw, setRaw] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.rpc('create_api_key', {
        p_workspace: workspace.id, p_name: name.trim(), p_kind: kind, p_bot: bot || null, p_scopes: kind === 'secret' ? scopes : null,
      })) as string,
    onSuccess: (key) => {
      setRaw(key)
      qc.invalidateQueries({ queryKey: ['api-keys', workspace.id] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const close = (v: boolean) => {
    onOpenChange(v)
    if (!v) {
      setRaw(null)
      setName('')
      setBot('')
    }
  }
  const needsBot = kind === 'publishable' && !bot
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={raw ? 'Your new key' : 'New API key'}
      footer={raw ? <Button variant="primary" onClick={() => close(false)}>Done</Button> : (
        <>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || needsBot || (kind === 'secret' && !scopes.length)} loading={create.isPending} onClick={() => create.mutate()}>Create key</Button>
        </>
      )}
    >
      {raw ? (
        <div className="flex flex-col gap-3">
          {kind === 'secret' ? (
            <Notice tone="warning" title="Copy it now">This is the only time the full key is shown. Store it in your server's secrets, never in an app.</Notice>
          ) : (
            <Notice tone="success">Use it in the widget snippet or your app. You can copy it again from the list.</Notice>
          )}
          <Secret value={raw} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Segmented
            value={kind}
            onChange={setKind}
            className="self-start"
            options={[{ value: 'publishable', label: 'Publishable' }, { value: 'secret', label: 'Secret' }]}
          />
          <Field label="Name" hint="So you know what uses it.">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'secret' ? (legal ? 'LegAI backend' : 'Production server') : 'Mobile app'} />
          </Field>
          <Field label="Bot" hint={kind === 'publishable' ? 'A publishable key always belongs to one bot.' : 'Leave empty to allow any bot (pass bot_id in each request).'}>
            <Select value={bot} onChange={(e) => setBot(e.target.value)}>
              <option value="">{kind === 'publishable' ? 'Choose a bot' : 'Any bot'}</option>
              {bots.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          {kind === 'secret' && (
            <Field label="Allowed">
              <div className="flex flex-col gap-2">
                {SCOPES.filter((s) => legal || s.id !== 'analyze').map((s) => (
                  <Checkbox
                    key={s.id}
                    checked={scopes.includes(s.id)}
                    onChange={(on) => setScopes(on ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))}
                    label={s.label}
                    description={s.description}
                  />
                ))}
              </div>
            </Field>
          )}
        </div>
      )}
    </Dialog>
  )
}
