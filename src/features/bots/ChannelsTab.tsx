import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Globe, KeyRound, MessageCircle, MoreHorizontal, Plus, Send, Smartphone, Trash2 } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, CodeBlock, ErrorBox, Notice, Secret, Segmented } from '@/components/ui/display.tsx'
import { Field, Input, Select, Switch, TagInput, Textarea } from '@/components/ui/form.tsx'
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger, useConfirm } from '@/components/ui/overlay.tsx'
import { admin, unwrap } from '@/lib/api.ts'
import { timeAgo } from '@/lib/format.ts'
import { useApiKeys } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import { API_URL, supabase, WIDGET_URL } from '@/lib/supabase.ts'
import type { Bot, ChannelRow } from '@/lib/types.ts'
import { useUpdateBot } from './BotDetailPage.tsx'
import { WidgetPreview } from './WidgetPreview.tsx'

type Section = 'web' | 'api' | 'whatsapp' | 'sms'

export function ChannelsTab({ bot }: { bot: Bot }) {
  const [section, setSection] = useState<Section>('web')
  return (
    <div className="flex flex-col gap-5">
      <Segmented<Section>
        value={section}
        onChange={setSection}
        className="self-start"
        options={[
          { value: 'web', label: <span className="inline-flex items-center gap-1.5"><Globe className="size-3.5" />Website</span> },
          { value: 'api', label: <span className="inline-flex items-center gap-1.5"><Smartphone className="size-3.5" />App / API</span> },
          { value: 'whatsapp', label: <span className="inline-flex items-center gap-1.5"><MessageCircle className="size-3.5" />WhatsApp</span> },
          { value: 'sms', label: <span className="inline-flex items-center gap-1.5"><Send className="size-3.5" />SMS</span> },
        ]}
      />
      {section === 'web' && <WebSection bot={bot} />}
      {section === 'api' && <ApiSection bot={bot} />}
      {section === 'whatsapp' && <MessagingSection bot={bot} kinds={['whatsapp']} />}
      {section === 'sms' && <MessagingSection bot={bot} kinds={['twilio_sms', 'africastalking_sms']} />}
    </div>
  )
}

// ── Website widget ────────────────────────────────────────────────────────

function WebSection({ bot }: { bot: Bot }) {
  const { can, base, workspace } = useWorkspace()
  const update = useUpdateBot(bot.id)
  const [w, setW] = useState(bot.widget)
  const [domains, setDomains] = useState(bot.allowed_domains)
  // Start over from the saved bot whenever it changes (e.g. after saving).
  const [saved, setSaved] = useState(bot)
  if (saved !== bot) {
    setSaved(bot)
    setW(bot.widget)
    setDomains(bot.allowed_domains)
  }
  const dirty = JSON.stringify(w) !== JSON.stringify(bot.widget) || JSON.stringify(domains) !== JSON.stringify(bot.allowed_domains)
  const set = (patch: Partial<Bot['widget']>) => setW((x) => ({ ...x, ...patch }))
  const keys = useApiKeys()
  const qc = useQueryClient()
  const botKey = keys.data?.find((k) => k.kind === 'publishable' && !k.revoked_at && (k.bot_id === bot.id || k.bot_id === null) && k.display_key)
  const createKey = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('create_api_key', { p_workspace: workspace.id, p_name: `${bot.name} widget`, p_kind: 'publishable', p_bot: bot.id })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', workspace.id] }),
    onError: (e) => toast.error((e as Error).message),
  })

  const snippet = `<script src="${WIDGET_URL}" async\n  data-key="${botKey?.display_key ?? 'bd_pk_YOUR_PUBLISHABLE_KEY'}"\n  data-api="${API_URL}"></script>`
  const readOnly = !can('editor')

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Add it to your site" description="Paste before the closing </body> tag. Works with any website builder (WordPress, Webflow, Framer, Shopify...)." />
          <div className="flex flex-col gap-3 border-t border-border px-5 py-5">
            {bot.status !== 'live' && (
              <Notice tone="warning" icon={<AlertTriangle />} title="This bot isn't live">The widget won't appear until you set the bot to Live (top right).</Notice>
            )}
            {!botKey && can('admin') && (
              <Notice tone="info" icon={<KeyRound />} title="Needs a publishable key">
                <div className="mt-1"><Button size="sm" variant="primary" loading={createKey.isPending} onClick={() => createKey.mutate()}>Create key for this bot</Button></div>
              </Notice>
            )}
            {!can('admin') && !botKey && <p className="text-[13px] text-muted">An admin can create the publishable key for this snippet.</p>}
            <CodeBlock code={snippet} label="Copy embed code" />
            <p className="text-xs text-muted">
              Open it from code with <code className="font-mono">window.BotDesk.open()</code> or ask a question with <code className="font-mono">window.BotDesk.ask('…')</code>.
            </p>
          </div>
        </Card>

        <fieldset disabled={readOnly}>
          <Card>
            <CardHeader title="Allowed websites" description="Only these sites can use the widget's key. Subdomains are included." />
            <div className="flex flex-col gap-3 border-t border-border px-5 py-5">
              <TagInput
                value={domains}
                onChange={setDomains}
                placeholder="example.com, shop.example.com"
                transform={(s) => s.trim().toLowerCase().replace(/^https?:\/\//, (m) => (s.includes('localhost') ? m : '')).replace(/\/$/, '')}
              />
              {!domains.length && (
                <Notice tone="warning" icon={<AlertTriangle />}>Any website can use this bot's key while the list is empty. Add your domains before going live.</Notice>
              )}
              <p className="text-xs text-muted">Use <code className="font-mono">http://localhost:5173</code> for local testing, and <code className="font-mono">app</code> to allow native mobile apps (no browser origin).</p>
            </div>
          </Card>
        </fieldset>

        <fieldset disabled={readOnly}>
          <Card>
            <CardHeader title="Look and feel" />
            <div className="grid gap-4 border-t border-border px-5 py-5 sm:grid-cols-2">
              <Field label="Brand colour" htmlFor="w-color">
                <div className="flex gap-2">
                  <input id="w-color" type="color" className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-surface p-1" value={w.primary_color ?? '#6d5df5'} onChange={(e) => set({ primary_color: e.target.value })} />
                  <Input aria-label="Colour hex" value={w.primary_color ?? ''} onChange={(e) => set({ primary_color: e.target.value })} />
                </div>
              </Field>
              <Field label="Position" htmlFor="w-pos">
                <Select id="w-pos" value={w.position ?? 'bottom-right'} onChange={(e) => set({ position: e.target.value as 'bottom-right' })}>
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                </Select>
              </Field>
              <Field label="Title" htmlFor="w-title"><Input id="w-title" value={w.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder={bot.name} /></Field>
              <Field label="Subtitle" htmlFor="w-sub" optional><Input id="w-sub" value={w.subtitle ?? ''} onChange={(e) => set({ subtitle: e.target.value })} placeholder="Usually replies instantly" /></Field>
              <Field label="Welcome message" htmlFor="w-welcome" className="sm:col-span-2">
                <Textarea id="w-welcome" rows={2} value={w.welcome_message ?? ''} onChange={(e) => set({ welcome_message: e.target.value })} />
              </Field>
              <Field label="Button label" htmlFor="w-launch" optional hint="Leave empty for an icon-only button.">
                <Input id="w-launch" value={w.launcher_label ?? ''} maxLength={24} onChange={(e) => set({ launcher_label: e.target.value })} placeholder="Ask us" />
              </Field>
              <Field label="Avatar image URL" htmlFor="w-avatar" optional>
                <Input id="w-avatar" type="url" value={w.avatar_url ?? ''} onChange={(e) => set({ avatar_url: e.target.value })} placeholder="https://…" />
              </Field>
              <Field label="Suggested questions" htmlFor="w-sugg" className="sm:col-span-2" hint="Up to four, shown before the first message. Press Enter after each.">
                <TagInput value={w.suggested_questions ?? []} onChange={(v) => set({ suggested_questions: v.slice(0, 4) })} placeholder="How long does delivery take?" />
              </Field>
              <div className="sm:col-span-2">
                <Switch checked={w.show_sources !== false} onChange={(v) => set({ show_sources: v })} label="Show sources under answers" description="Visitors can open the passages each answer came from." />
              </div>
            </div>
            {dirty && (
              <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                <Button variant="ghost" onClick={() => { setW(bot.widget); setDomains(bot.allowed_domains) }}>Discard</Button>
                <Button variant="primary" loading={update.isPending} onClick={() => update.mutate({ widget: w, allowed_domains: domains }, { onSuccess: () => toast.success('Widget saved.') })}>Save widget</Button>
              </div>
            )}
          </Card>
        </fieldset>
      </div>
      <div className="flex flex-col gap-2 xl:sticky xl:top-6 xl:self-start">
        <p className="text-[13px] font-medium text-muted">Preview</p>
        <WidgetPreview widget={w} name={bot.name} disclaimer={bot.legal?.enabled ? (bot.legal.disclaimer || 'General legal information, not legal advice.') : null} />
        <Link to={`${base}/bots/${bot.id}/playground`} className="text-[13px] font-medium text-primary-text hover:underline">Try real answers in the playground →</Link>
      </div>
    </div>
  )
}

// ── API ───────────────────────────────────────────────────────────────────

function ApiSection({ bot }: { bot: Bot }) {
  const { base, legal, can } = useWorkspace()
  const [lang, setLang] = useState<'curl' | 'js' | 'dart'>('curl')
  const code = useMemo(() => {
    const body = `{"bot_id": "${bot.id}", "message": "How much notice do I get?", "user": {"id": "user-123"}${legal ? ', "jurisdiction": "MW", "format": "legal"' : ''}}`
    if (lang === 'curl') {
      return `curl ${API_URL}/v1/chat \\\n  -H "Authorization: Bearer $BOTDESK_SECRET_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`
    }
    if (lang === 'js') {
      return `// Server-side only: never ship a secret key in a browser or app bundle.
const res = await fetch('${API_URL}/v1/chat', {
  method: 'POST',
  headers: { Authorization: \`Bearer \${process.env.BOTDESK_SECRET_KEY}\`, 'Content-Type': 'application/json' },
  body: JSON.stringify(${body}),
})
const { conversation_id, answer } = await res.json()
// answer.text, answer.citations, answer.outcome${legal ? ', answer.legal (summary, points, sources)' : ''}`
    }
    return `// Flutter: call through your own backend (e.g. a Supabase Edge Function)
// that adds the secret key, so it never ships inside the app.
final res = await http.post(
  Uri.parse('$backendUrl/botdesk/chat'),
  headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer $userToken'},
  body: jsonEncode({'message': question, 'conversation_id': conversationId${legal ? ", 'jurisdiction': 'MW', 'format': 'legal'" : ''}}),
);
final answer = jsonDecode(res.body)['answer'];`
  }, [lang, bot.id, legal])

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Use from your app or server" description="Send a question, get a grounded answer with citations. Conversations show up in the inbox like any other channel." />
        <div className="flex flex-col gap-4 border-t border-border px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Endpoint"><Secret value={`${API_URL}/v1/chat`} /></Field>
            <Field label="Bot ID"><Secret value={bot.id} /></Field>
          </div>
          <Notice tone="info" icon={<KeyRound />}>
            Use a <b>secret key</b> (bd_sk_…) from your server.{' '}
            {can('admin') ? <Link to={`${base}/settings/keys`} className="font-medium underline">Create one in Settings → API keys</Link> : 'An admin can create one.'}
          </Notice>
          <Segmented value={lang} onChange={setLang} className="self-start" options={[{ value: 'curl', label: 'curl' }, { value: 'js', label: 'Node / JS' }, { value: 'dart', label: 'Flutter' }]} />
          <CodeBlock code={code} />
          <p className="text-[13px] text-muted">
            Add <code className="font-mono">"stream": true</code> for server-sent events (start, delta, done). Full reference: <code className="font-mono">docs/API.md</code>.
          </p>
        </div>
      </Card>
      {legal && (
        <Card>
          <CardHeader title="Legal pack endpoints" description="Used by LegAI's Listen In: flag what matters in a live conversation, then summarise it." />
          <div className="flex flex-col gap-3 border-t border-border px-5 py-5">
            <CodeBlock code={`POST ${API_URL}/v1/legal/analyze
{"bot_id": "${bot.id}",
 "segment": {"id": "s12", "text": "We think it's best you resign today.", "start_ms": 754000, "speaker": "Manager"},
 "context": {"topic": "work", "jurisdiction": "MW", "already_flagged": []}}

→ {"flags": [{"key": "pressure_to_resign", "kind": "caution", "title": "You don't have to sign today.",
              "body": "...", "quote": "...", "citation": "Employment Act · s. 57", "at_ms": 754000}]}

POST ${API_URL}/v1/legal/summarize
{"bot_id": "${bot.id}", "segments": [...], "flags": [...], "topic": "work"}  →  {"summary": "..."}`} />
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Feed knowledge by API" description="Keep documents in sync from your own systems (a content system, a legal database...)." />
        <div className="border-t border-border px-5 py-5">
          <CodeBlock code={`POST ${API_URL}/v1/sources          (JSON: kind text | qa | url | sitemap, knowledge_base_id, external_id...)
POST ${API_URL}/v1/sources/upload   (multipart: file, knowledge_base_id, jurisdiction, source_type, citation...)
GET  ${API_URL}/v1/sources/:id      (status: queued → processing → ready)`} />
        </div>
      </Card>
    </div>
  )
}

// ── WhatsApp and SMS ──────────────────────────────────────────────────────

const KIND_INFO: Record<ChannelRow['kind'], { name: string; config: { key: string; label: string; hint?: string; placeholder?: string }[]; secrets: { key: string; label: string; hint?: string }[]; steps: ReactNode }> = {
  whatsapp: {
    name: 'WhatsApp Cloud API',
    config: [{ key: 'phone_number_id', label: 'Phone number ID', hint: 'Meta app → WhatsApp → API setup.', placeholder: '106540352242922' }],
    secrets: [
      { key: 'access_token', label: 'Access token', hint: 'A permanent system-user token with whatsapp_business_messaging.' },
      { key: 'app_secret', label: 'App secret', hint: 'Meta app → Settings → Basic. Used to check webhook signatures.' },
    ],
    steps: <>In your Meta app go to <b>WhatsApp → Configuration</b>, set the <b>Callback URL</b> and <b>Verify token</b> below, then subscribe to the <b>messages</b> field.</>,
  },
  twilio_sms: {
    name: 'Twilio SMS',
    config: [
      { key: 'account_sid', label: 'Account SID', placeholder: 'AC…' },
      { key: 'from_number', label: 'Twilio phone number', placeholder: '+15551234567' },
    ],
    secrets: [{ key: 'auth_token', label: 'Auth token', hint: 'Also used to check that webhooks really come from Twilio.' }],
    steps: <>In Twilio open the phone number, and under <b>Messaging → A message comes in</b> choose <b>Webhook</b>, <b>HTTP POST</b>, and paste the URL below.</>,
  },
  africastalking_sms: {
    name: "Africa's Talking SMS",
    config: [
      { key: 'username', label: 'Username', hint: 'Use "sandbox" while testing.' },
      { key: 'from', label: 'Short code or sender ID', placeholder: '12345' },
    ],
    secrets: [{ key: 'api_key', label: 'API key' }],
    steps: <>In Africa's Talking go to <b>SMS → SMS callback URLs → Incoming messages</b> and paste the URL below. Keep it private: it is the channel's password.</>,
  },
}

function MessagingSection({ bot, kinds }: { bot: Bot; kinds: ChannelRow['kind'][] }) {
  const { workspace, can } = useWorkspace()
  const qc = useQueryClient()
  const [adding, setAdding] = useState<ChannelRow['kind'] | null>(null)
  const [testing, setTesting] = useState<ChannelRow | null>(null)
  const { confirm, element } = useConfirm()
  const channels = useQuery({
    queryKey: ['channels', bot.id],
    enabled: can('editor'),
    queryFn: () => admin<{ channels: ChannelRow[] }>(`/channels?workspace_id=${workspace.id}&bot_id=${bot.id}`),
  })
  const rows = (channels.data?.channels ?? []).filter((c) => kinds.includes(c.kind))
  const patch = useMutation({
    mutationFn: async ({ id, ...p }: { id: string; status?: string }) => unwrap(await supabase.from('bot_channels').update(p).eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', bot.id] }),
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('bot_channels').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels', bot.id] }),
  })

  return (
    <div className="flex flex-col gap-5">
      {rows.map((c) => (
        <Card key={c.id}>
          <CardHeader
            title={<span className="flex items-center gap-2">{c.name || KIND_INFO[c.kind].name}<Badge tone={c.status === 'active' ? 'success' : 'neutral'} dot>{c.status === 'active' ? 'Active' : 'Off'}</Badge></span>}
            description={`${KIND_INFO[c.kind].name} · connected ${timeAgo(c.created_at)}`}
            actions={can('admin') && (
              <>
                <Button size="sm" icon={<Send />} onClick={() => setTesting(c)}>Send test</Button>
                <Menu>
                  <MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={() => patch.mutate({ id: c.id, status: c.status === 'active' ? 'disabled' : 'active' })}>{c.status === 'active' ? 'Turn off' : 'Turn on'}</MenuItem>
                    <MenuItem danger icon={<Trash2 />} onSelect={async () => {
                      if (await confirm('Disconnect this channel?', { body: 'Messages to this number stop reaching the bot. Its saved tokens are deleted.', action: 'Disconnect' })) remove.mutate(c.id)
                    }}>Disconnect</MenuItem>
                  </MenuContent>
                </Menu>
              </>
            )}
          />
          <div className="flex flex-col gap-3 border-t border-border px-5 py-5">
            <p className="text-[13px] text-muted">{KIND_INFO[c.kind].steps}</p>
            <Field label={c.kind === 'whatsapp' ? 'Callback URL' : 'Webhook URL'}><Secret value={c.webhook_url} /></Field>
            {c.verify_token && <Field label="Verify token"><Secret value={c.verify_token} /></Field>}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted">
              {Object.entries(c.config).filter(([k]) => k !== 'graph_version').map(([k, v]) => <span key={k}>{k.replace(/_/g, ' ')}: <span className="text-fg">{String(v)}</span></span>)}
            </div>
          </div>
        </Card>
      ))}
      <Card>
        <CardHeader
          title={rows.length ? 'Add another' : kinds[0] === 'whatsapp' ? 'Connect WhatsApp' : 'Connect SMS'}
          description={kinds[0] === 'whatsapp'
            ? 'Answer customers on WhatsApp with the WhatsApp Business Cloud API from Meta.'
            : "Answer text messages through Twilio (worldwide) or Africa's Talking (Malawi, Kenya, Nigeria and more)."}
        />
        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
          {kinds.map((k) => (
            <Button key={k} icon={<Plus />} disabled={!can('admin')} onClick={() => setAdding(k)}>{KIND_INFO[k].name}</Button>
          ))}
          {!can('admin') && <p className="w-full text-xs text-muted">Only admins can connect channels.</p>}
        </div>
      </Card>
      {adding && <ConnectDialog bot={bot} kind={adding} onClose={() => setAdding(null)} />}
      {testing && <TestDialog channel={testing} onClose={() => setTesting(null)} />}
      {element}
    </div>
  )
}

function ConnectDialog({ bot, kind, onClose }: { bot: Bot; kind: ChannelRow['kind']; onClose: () => void }) {
  const { workspace } = useWorkspace()
  const info = KIND_INFO[kind]
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, string | boolean>>({})
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const connect = useMutation({
    mutationFn: () => admin<{ channel: ChannelRow }>('/channels', { json: { workspace_id: workspace.id, bot_id: bot.id, kind, name, config, secrets } }),
    onSuccess: () => {
      toast.success('Connected. Now paste the webhook URL into the provider.')
      qc.invalidateQueries({ queryKey: ['channels', bot.id] })
      onClose()
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Connect ${info.name}`}
      description="Tokens are encrypted in Supabase Vault and never shown again."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>Connect</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="ch-name" optional><Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main support number" /></Field>
        {info.config.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`ch-${f.key}`} hint={f.hint}>
            <Input id={`ch-${f.key}`} value={String(config[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value.trim() })} />
          </Field>
        ))}
        {kind === 'africastalking_sms' && (
          <Switch checked={!!config.sandbox} onChange={(v) => setConfig({ ...config, sandbox: v })} label="Sandbox" description="Send through Africa's Talking's test environment." />
        )}
        {info.secrets.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`ch-s-${f.key}`} hint={f.hint}>
            <Input id={`ch-s-${f.key}`} type="password" autoComplete="off" value={secrets[f.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} />
          </Field>
        ))}
        <ErrorBox error={connect.error} />
      </div>
    </Dialog>
  )
}

function TestDialog({ channel, onClose }: { channel: ChannelRow; onClose: () => void }) {
  const { workspace } = useWorkspace()
  const [to, setTo] = useState('')
  const send = useMutation({
    mutationFn: () => admin<{ ok: boolean; error?: string }>(`/channels/${channel.id}/test`, { json: { workspace_id: workspace.id, to } }),
    onSuccess: (r) => (r.ok ? toast.success('Test message sent.') : toast.error(r.error ?? 'Sending failed.')),
  })
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Send a test message" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" loading={send.isPending} disabled={!to.trim()} onClick={() => send.mutate()}>Send</Button></>}>
      <Field label="To" htmlFor="t-to" hint={channel.kind === 'whatsapp' ? 'The number must have messaged you in the last 24 hours, or be a test number in your Meta app.' : 'International format.'}>
        <Input id="t-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="+265991234567" />
      </Field>
    </Dialog>
  )
}

