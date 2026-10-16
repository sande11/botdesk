import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Scale, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Page } from '@/components/layout/AppShell.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardHeader, Notice, PageHeader, Tabs } from '@/components/ui/display.tsx'
import { Field, Input, Select, Switch, TagInput } from '@/components/ui/form.tsx'
import { Dialog } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { useAuth, useProfile, useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { Workspace } from '@/lib/types.ts'
import { ApiKeysTab } from './ApiKeysTab.tsx'
import { AuditTab } from './AuditTab.tsx'
import { MembersTab } from './MembersTab.tsx'
import { ModelsTab } from './ModelsTab.tsx'
import { UsageTab } from './UsageTab.tsx'

export default function SettingsPage() {
  const { tab = 'general' } = useParams()
  const { base, can, legal } = useWorkspace()
  const navigate = useNavigate()
  const admin = can('admin')
  return (
    <Page>
      <PageHeader title="Settings" />
      <Tabs
        value={tab}
        onChange={(t) => navigate(`${base}/settings/${t}`)}
        className="mb-6"
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'legal', label: 'Legal pack', hidden: !legal },
          { value: 'members', label: 'Members' },
          { value: 'keys', label: 'API keys', hidden: !admin },
          { value: 'models', label: 'Models', hidden: !admin },
          { value: 'usage', label: 'Usage & plan' },
          { value: 'audit', label: 'Audit log', hidden: !admin },
        ]}
      />
      {tab === 'legal' && legal ? <LegalTab />
        : tab === 'members' ? <MembersTab />
        : tab === 'keys' && admin ? <ApiKeysTab />
        : tab === 'models' && admin ? <ModelsTab />
        : tab === 'usage' ? <UsageTab />
        : tab === 'audit' && admin ? <AuditTab />
        : <GeneralTab />}
    </Page>
  )
}

/** Saves workspace name/features/settings and refreshes the cached membership. */
export function useUpdateWorkspace() {
  const { workspace } = useWorkspace()
  const { session } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Workspace, 'name' | 'features' | 'settings'>>) =>
      unwrap(await supabase.from('workspaces').update(patch).eq('id', workspace.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memberships', session?.user.id] })
      toast.success('Saved.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
}

function GeneralTab() {
  const { workspace, can, plan, role } = useWorkspace()
  const update = useUpdateWorkspace()
  const admin = can('admin')
  const s = workspace.settings
  const [name, setName] = useState(workspace.name)
  const [notify, setNotify] = useState(s.notify_email ?? '')
  const [retention, setRetention] = useState(String(s.retention_days ?? 0))
  const [reviewQueue, setReviewQueue] = useState(s.review_queue !== false)
  const [sample, setSample] = useState(String(s.review_sample_rate ?? (workspace.features.legal ? 0.1 : 0)))
  const [platformAi, setPlatformAi] = useState(s.allow_platform_ai !== false)
  const [legalPack, setLegalPack] = useState(workspace.features.legal === true)

  const save = () =>
    update.mutate({
      name: name.trim() || workspace.name,
      features: { ...workspace.features, legal: legalPack },
      settings: {
        ...s,
        notify_email: notify.trim() || undefined,
        retention_days: Number(retention),
        review_queue: reviewQueue,
        review_sample_rate: Number(sample),
        allow_platform_ai: platformAi,
      },
    })

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <ProfileCard />
      <Card>
        <CardHeader title="Workspace" description={`You are ${role === 'owner' ? 'the owner' : `${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role}`} of this workspace.`} />
        <fieldset disabled={!admin} className="flex flex-col gap-4 px-5 pb-5">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <Field label="Hand-off emails" optional hint="Where to email when a customer asks for a person. A bot can override this.">
            <Input type="email" value={notify} onChange={(e) => setNotify(e.target.value)} placeholder="support@example.com" />
          </Field>
          <Field label="Keep conversations for" hint="Older conversations and their messages are deleted every night.">
            <Select value={retention} onChange={(e) => setRetention(e.target.value)}>
              <option value="0">Forever</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="180">6 months</option>
              <option value="365">1 year</option>
              <option value="730">2 years</option>
            </Select>
          </Field>
        </fieldset>
      </Card>

      <Card>
        <CardHeader title="Answer review" description="Unsure answers go to the review queue so the team can correct them." />
        <fieldset disabled={!admin} className="flex flex-col gap-4 px-5 pb-5">
          <Switch checked={reviewQueue} onChange={setReviewQueue} label="Send unsure answers to review" description="Questions the bot couldn't answer and answers with low confidence. Thumbs-down answers always go to review." />
          <Field label="Also check a random sample" hint="Spot-checks answers the bot was sure about.">
            <Select value={sample} onChange={(e) => setSample(e.target.value)} disabled={!reviewQueue}>
              <option value="0">None</option>
              <option value="0.02">2% of answers</option>
              <option value="0.05">5% of answers</option>
              <option value="0.1">10% of answers</option>
              <option value="0.25">25% of answers</option>
              {!['0', '0.02', '0.05', '0.1', '0.25'].includes(sample) && <option value={sample}>{Math.round(Number(sample) * 100)}% of answers</option>}
            </Select>
          </Field>
        </fieldset>
      </Card>

      <Card>
        <CardHeader title="Features" />
        <fieldset disabled={!admin} className="flex flex-col gap-4 px-5 pb-5">
          <Switch
            checked={legalPack}
            onChange={setLegalPack}
            label={<span className="inline-flex items-center gap-1.5"><Scale className="size-4" />Legal pack</span>}
            description="Jurisdictions, legal source metadata, structured answers with disclaimers, Listen In analysis, and lawyer review. Used by LegAI."
          />
          {plan?.limits.platform_ai !== false && (
            <Switch
              checked={platformAi}
              onChange={setPlatformAi}
              label="Use BotDesk's AI keys when you have none"
              description="Turn off to make sure only your own provider keys are used."
            />
          )}
        </fieldset>
      </Card>

      {admin && (
        <div className="flex justify-end">
          <Button variant="primary" loading={update.isPending} onClick={save}>Save changes</Button>
        </div>
      )}

      {role === 'owner' && <DeleteWorkspace />}
    </div>
  )
}

function ProfileCard() {
  const profile = useProfile()
  const qc = useQueryClient()
  const { session } = useAuth()
  const [name, setName] = useState<string | null>(null)
  const value = name ?? profile.data?.full_name ?? ''
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.from('profiles').update({ full_name: value.trim() || null }).eq('id', session!.user.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', session?.user.id] })
      qc.invalidateQueries({ queryKey: ['member-names'] })
      toast.success('Saved.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Card>
      <CardHeader title="Your profile" description={profile.data?.email ?? undefined} />
      <div className="flex items-end gap-3 px-5 pb-5">
        <Field label="Your name" className="flex-1"><Input value={value} onChange={(e) => setName(e.target.value)} placeholder="Ada Banda" /></Field>
        <Button disabled={name === null || name === (profile.data?.full_name ?? '')} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Card>
  )
}

function DeleteWorkspace() {
  const { workspace } = useWorkspace()
  const { session } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('workspaces').delete().eq('id', workspace.id)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['memberships', session?.user.id] })
      toast.success('Workspace deleted.')
      navigate('/')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Card className="border-danger/30">
      <CardHeader
        title="Delete workspace"
        description="Deletes every bot, knowledge base, conversation, key and file in it. This cannot be undone."
        actions={<Button variant="danger" icon={<Trash2 />} onClick={() => { setTyped(''); setOpen(true) }}>Delete</Button>}
      />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title={`Delete ${workspace.name}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={typed.trim() !== workspace.slug} loading={remove.isPending} onClick={() => remove.mutate()}>Delete forever</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">All data in this workspace is deleted for everyone. Widgets, apps and channels using it stop working immediately.</p>
          <Field label={<>Type <code className="rounded bg-surface-2 px-1 font-mono">{workspace.slug}</code> to confirm</>}>
            <Input autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </Card>
  )
}

function LegalTab() {
  const { workspace, can } = useWorkspace()
  const update = useUpdateWorkspace()
  const s = workspace.settings
  const [jurisdictions, setJurisdictions] = useState<string[]>(s.jurisdictions ?? [])
  const [def, setDef] = useState(s.default_jurisdiction ?? '')
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Notice tone="info" icon={<Scale />} title="Running LegAI on BotDesk">
        The LegAI app talks to a legal bot in this workspace through the API with a secret key: <code>/v1/chat</code> with <code>format: "legal"</code> for structured answers,
        and <code>/v1/legal/analyze</code> and <code>/v1/legal/summarize</code> for Listen In. Lawyers review answers in Review; verified answers flow back into the knowledge base.
      </Notice>
      <Card>
        <CardHeader title="Jurisdictions" description="Sources and questions are tagged with a jurisdiction so answers only use the right law." />
        <fieldset disabled={!can('admin')} className="flex flex-col gap-4 px-5 pb-5">
          <Field label="Jurisdictions you cover" hint="ISO country codes, or country-region (e.g. MW, KE, ZA-GP). Press Enter after each.">
            <TagInput value={jurisdictions} onChange={setJurisdictions} transform={(v) => v.trim().toUpperCase().replace(/[^A-Z-]/g, '').slice(0, 12)} placeholder="MW" />
          </Field>
          <Field label="Default jurisdiction" hint="Used when the app or the person doesn't say which one applies. A bot can override this.">
            <Select value={def} onChange={(e) => setDef(e.target.value)}>
              <option value="">None</option>
              {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
            </Select>
          </Field>
        </fieldset>
      </Card>
      {can('admin') && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={() => update.mutate({ settings: { ...s, jurisdictions, default_jurisdiction: jurisdictions.includes(def) ? def : jurisdictions[0] } })}
          >
            Save changes
          </Button>
        </div>
      )}
    </div>
  )
}
