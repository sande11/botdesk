import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, Mail, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, Loading, Meter, Notice, Secret } from '@/components/ui/display.tsx'
import { Field, Input, Select } from '@/components/ui/form.tsx'
import { Dialog, useConfirm } from '@/components/ui/overlay.tsx'
import { admin, unwrap } from '@/lib/api.ts'
import { initials, timeAgo } from '@/lib/format.ts'
import { useAuth, useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import { ROLE_INFO, ROLE_RANK, type Role } from '@/lib/types.ts'

interface MemberRow {
  user_id: string
  role: Role
  created_at: string
  profile?: { email: string | null; full_name: string | null }
}

interface InviteRow {
  id: string
  email: string
  role: Role
  expires_at: string
  created_at: string
}

const ROLES: Role[] = ['owner', 'admin', 'editor', 'reviewer', 'viewer']

export function MembersTab() {
  const { workspace, can, role: myRole, plan } = useWorkspace()
  const { session } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { confirm, element } = useConfirm()
  const [inviting, setInviting] = useState(false)
  const isAdmin = can('admin')

  const members = useQuery({
    queryKey: ['members', workspace.id],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('workspace_members').select('user_id, role, created_at').eq('workspace_id', workspace.id).order('created_at')) as MemberRow[]
      const profiles = unwrap(await supabase.from('profiles').select('id, email, full_name').in('id', rows.map((r) => r.user_id))) as { id: string; email: string | null; full_name: string | null }[]
      const byId = new Map(profiles.map((p) => [p.id, p]))
      return rows.map((r) => ({ ...r, profile: byId.get(r.user_id) }))
    },
  })
  const invites = useQuery({
    queryKey: ['invites', workspace.id],
    enabled: isAdmin,
    queryFn: async () =>
      unwrap(await supabase.from('workspace_invites').select('id, email, role, expires_at, created_at').eq('workspace_id', workspace.id).is('accepted_at', null).order('created_at', { ascending: false })) as InviteRow[],
  })

  const changeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: Role }) => unwrap(await supabase.from('workspace_members').update({ role }).eq('workspace_id', workspace.id).eq('user_id', userId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', workspace.id] })
      toast.success('Role changed.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const removeMember = useMutation({
    mutationFn: async (userId: string) => unwrap(await supabase.from('workspace_members').delete().eq('workspace_id', workspace.id).eq('user_id', userId)),
    onSuccess: (_, userId) => {
      if (userId === session?.user.id) {
        qc.invalidateQueries({ queryKey: ['memberships', session?.user.id] })
        navigate('/')
        return
      }
      qc.invalidateQueries({ queryKey: ['members', workspace.id] })
      toast.success('Removed from the workspace.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const revokeInvite = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('workspace_invites').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', workspace.id] }),
    onError: (e) => toast.error((e as Error).message),
  })

  const limit = plan?.limits.members ?? null
  const used = (members.data?.length ?? 0) + (invites.data?.length ?? 0)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Card>
        <CardHeader
          title="Members"
          description={limit != null ? `${used} of ${limit} seats on the ${plan?.name} plan, including open invites.` : 'Everyone who can use this workspace.'}
          actions={isAdmin && <Button variant="primary" size="sm" icon={<UserPlus />} disabled={limit != null && used >= limit} onClick={() => setInviting(true)}>Invite</Button>}
        />
        {limit != null && <div className="px-5 pb-3"><Meter value={used} max={limit} /></div>}
        {members.isLoading ? <Loading /> : (
          <ul className="divide-y divide-border border-t border-border">
            {members.data?.map((m) => {
              const me = m.user_id === session?.user.id
              const name = m.profile?.full_name || m.profile?.email || 'Member'
              // Admins manage everyone below owner; owners manage everyone.
              const manageable = isAdmin && !me && (myRole === 'owner' || m.role !== 'owner')
              return (
                <li key={m.user_id} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary-text">{initials(name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}{me && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</p>
                    <p className="truncate text-xs text-muted">{m.profile?.email} · joined {timeAgo(m.created_at)}</p>
                  </div>
                  {manageable ? (
                    <Select
                      aria-label={`Role for ${name}`}
                      className="w-[130px]"
                      value={m.role}
                      onChange={(e) => changeRole.mutate({ userId: m.user_id, role: e.target.value as Role })}
                    >
                      {ROLES.filter((r) => myRole === 'owner' || r !== 'owner').map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                    </Select>
                  ) : (
                    <Badge tone={m.role === 'owner' ? 'primary' : 'neutral'}>{m.role}</Badge>
                  )}
                  {(manageable || me) && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={me ? 'Leave workspace' : `Remove ${name}`}
                      onClick={async () => {
                        if (await confirm(me ? `Leave ${workspace.name}?` : `Remove ${name}?`, {
                          action: me ? 'Leave' : 'Remove',
                          body: me ? 'You lose access until someone invites you again.' : 'They lose access to this workspace right away.',
                        })) removeMember.mutate(m.user_id)
                      }}
                    >
                      {me ? <LogOut /> : <Trash2 />}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {isAdmin && !!invites.data?.length && (
        <Card>
          <CardHeader title="Open invites" />
          <ul className="divide-y divide-border border-t border-border">
            {invites.data.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                <Mail className="size-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{i.email}</p>
                  <p className="text-xs text-muted">{new Date(i.expires_at) < new Date() ? 'Expired' : `Expires ${timeAgo(i.expires_at)}`}</p>
                </div>
                <Badge>{i.role}</Badge>
                <Button variant="ghost" size="sm" onClick={() => revokeInvite.mutate(i.id)}>Revoke</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Roles" />
        <dl className="grid gap-x-6 gap-y-2 border-t border-border px-5 py-4 text-[13px] sm:grid-cols-[110px_1fr]">
          {ROLES.map((r) => (
            <div key={r} className="contents">
              <dt className="font-medium capitalize">{r}</dt>
              <dd className="text-muted">{ROLE_INFO[r]}{ROLE_RANK[r] < ROLE_RANK.owner && r !== 'viewer' ? ', plus everything below' : ''}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <InviteDialog open={inviting} onOpenChange={setInviting} />
      {element}
    </div>
  )
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspace, legal } = useWorkspace()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>(legal ? 'reviewer' : 'editor')
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null)
  const invite = useMutation({
    mutationFn: () => admin<{ link: string; emailed: boolean }>('/invites', { json: { workspace_id: workspace.id, email: email.trim(), role } }),
    onSuccess: (r) => {
      setResult(r)
      qc.invalidateQueries({ queryKey: ['invites', workspace.id] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const close = (v: boolean) => {
    onOpenChange(v)
    if (!v) {
      setResult(null)
      setEmail('')
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={result ? 'Invite created' : 'Invite a teammate'}
      footer={result ? <Button variant="primary" onClick={() => close(false)}>Done</Button> : (
        <>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} loading={invite.isPending} onClick={() => invite.mutate()}>Send invite</Button>
        </>
      )}
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <Notice tone={result.emailed ? 'success' : 'info'}>
            {result.emailed ? `We emailed ${email}. You can also send them this link.` : 'Email is not set up on this server, so send them this link yourself. It works once and expires in 7 days.'}
          </Notice>
          <Secret value={result.link} />
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); invite.mutate() }}>
          <Field label="Email"><Input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
          <Field label="Role" hint={ROLE_INFO[role]}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(['admin', 'editor', 'reviewer', 'viewer'] as Role[]).map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
            </Select>
          </Field>
        </form>
      )}
    </Dialog>
  )
}
