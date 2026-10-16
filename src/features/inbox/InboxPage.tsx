import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle2,
  Globe,
  Inbox as InboxIcon,
  MessageCircle,
  MoreHorizontal,
  RotateCcw,
  Search,
  Send,
  Smartphone,
  Trash2,
  UserCheck,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfidenceBadge, LegalCard, Markdown, Sources } from '@/components/MessageView.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Empty, Loading, Notice, Segmented } from '@/components/ui/display.tsx'
import { Input, Select, Textarea } from '@/components/ui/form.tsx'
import { Menu, MenuContent, MenuItem, MenuTrigger, useConfirm } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { CHANNEL_LABEL, dateTime, initials, timeAgo } from '@/lib/format.ts'
import { useBots, useMembersById } from '@/lib/queries.ts'
import { useAuth, useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { Channel, Conversation, Message } from '@/lib/types.ts'
import { QuickAnswerDialog } from '../knowledge/QuickAnswerDialog.tsx'

type Filter = 'handoff' | 'open' | 'resolved' | 'all'

const CHANNEL_ICON: Record<Channel, ReactNode> = {
  web: <Globe />,
  api: <Smartphone />,
  whatsapp: <MessageCircle />,
  sms: <MessageCircle />,
}

function contactName(c: Conversation) {
  const ct = c.contacts
  return ct?.name || ct?.email || ct?.phone || (c.channel === 'web' ? `Visitor ${ct?.external_id.slice(-4) ?? ''}` : ct?.external_id) || 'Unknown'
}

/** Live updates: new messages and status changes refresh the inbox. */
function useInboxRealtime(workspaceId: string) {
  const qc = useQueryClient()
  useEffect(() => {
    const ch = supabase
      .channel(`inbox:${workspaceId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `workspace_id=eq.${workspaceId}` }, (p) => {
        qc.invalidateQueries({ queryKey: ['messages', (p.new as Message).conversation_id] })
        qc.invalidateQueries({ queryKey: ['conversations', workspaceId] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `workspace_id=eq.${workspaceId}` }, () => {
        qc.invalidateQueries({ queryKey: ['conversations', workspaceId] })
        qc.invalidateQueries({ queryKey: ['nav-counts', workspaceId] })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [workspaceId, qc])
}

export default function InboxPage() {
  const { workspace, base } = useWorkspace()
  const { conversationId } = useParams()
  const [filter, setFilter] = useState<Filter>('handoff')
  const [channel, setChannel] = useState<'' | Channel>('')
  const [botId, setBotId] = useState('')
  const [q, setQ] = useState('')
  const bots = useBots()
  useInboxRealtime(workspace.id)

  const list = useQuery({
    queryKey: ['conversations', workspace.id, filter, channel, botId],
    queryFn: async () => {
      let query = supabase.from('conversations')
        .select('*, contacts(id, channel, external_id, name, email, phone, metadata), bots(name)')
        .eq('workspace_id', workspace.id)
        .order('last_message_at', { ascending: false })
        .limit(100)
      if (filter !== 'all') query = query.eq('status', filter)
      if (channel) query = query.eq('channel', channel)
      if (botId) query = query.eq('bot_id', botId)
      return unwrap(await query) as Conversation[]
    },
  })
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return list.data ?? []
    return (list.data ?? []).filter((c) => `${c.title ?? ''} ${contactName(c)}`.toLowerCase().includes(needle))
  }, [list.data, q])

  return (
    <div className="flex h-full min-h-0">
      <section className={cn('flex w-full min-w-0 flex-col border-r border-border md:w-[360px] md:shrink-0', conversationId && 'hidden md:flex')}>
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <h1 className="font-display text-[28px] leading-none">Inbox</h1>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'handoff', label: 'Needs a person' },
              { value: 'open', label: 'Bot' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'all', label: 'All' },
            ]}
          />
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" />
              <Input aria-label="Search conversations" placeholder="Search" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select aria-label="Channel" className="w-[118px]" value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')}>
              <option value="">All channels</option>
              {(['web', 'api', 'whatsapp', 'sms'] as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
            </Select>
          </div>
          {(bots.data?.length ?? 0) > 1 && (
            <Select aria-label="Bot" value={botId} onChange={(e) => setBotId(e.target.value)}>
              <option value="">All bots</option>
              {bots.data!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto">
          {list.isLoading ? <Loading /> : !items.length ? (
            <Empty
              icon={<InboxIcon />}
              title={filter === 'handoff' ? 'Nobody is waiting' : 'No conversations'}
              description={filter === 'handoff' ? 'Conversations show up here when someone asks for a person.' : 'Conversations from every channel land here.'}
            />
          ) : (
            <ul>
              {items.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`${base}/inbox/${c.id}`}
                    className={cn(
                      'flex gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-surface-2',
                      c.id === conversationId && 'bg-primary-soft/60 hover:bg-primary-soft/60',
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold">{initials(contactName(c))}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{contactName(c)}</span>
                        <span className="ml-auto shrink-0 text-xs text-subtle">{timeAgo(c.last_message_at)}</span>
                      </span>
                      <span className="truncate text-[13px] text-muted">{c.title ?? 'No messages yet'}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-subtle [&_svg]:size-3.5">
                        {CHANNEL_ICON[c.channel]} {CHANNEL_LABEL[c.channel]}
                        {c.bots?.name && <span className="truncate">· {c.bots.name}</span>}
                        {c.status === 'handoff' && <Badge tone="warning" className="ml-auto h-5">Waiting</Badge>}
                        {c.status !== 'handoff' && c.unanswered > 0 && <Badge tone="neutral" className="ml-auto h-5">{c.unanswered} unanswered</Badge>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className={cn('min-w-0 flex-1', !conversationId && 'hidden md:block')}>
        {conversationId ? (
          <ConversationView id={conversationId} />
        ) : (
          <Empty icon={<MessageCircle />} title="Pick a conversation" description="Read what was asked, check the bot's sources, or reply as a person." className="h-full" />
        )}
      </section>
    </div>
  )
}

function ConversationView({ id }: { id: string }) {
  const { workspace, base, can } = useWorkspace()
  const { session } = useAuth()
  const names = useMembersById()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { confirm, element: confirmEl } = useConfirm()
  const [draft, setDraft] = useState('')
  const [gap, setGap] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const conv = useQuery({
    queryKey: ['conversation', id],
    queryFn: async () =>
      unwrap(await supabase.from('conversations').select('*, contacts(*), bots(name)').eq('id', id).eq('workspace_id', workspace.id).single()) as Conversation,
  })
  const messages = useQuery({
    queryKey: ['messages', id],
    queryFn: async () => unwrap(await supabase.from('messages').select('*').eq('conversation_id', id).order('created_at').limit(500)) as Message[],
  })
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [messages.data?.length])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['conversation', id] })
    qc.invalidateQueries({ queryKey: ['conversations', workspace.id] })
    qc.invalidateQueries({ queryKey: ['nav-counts', workspace.id] })
  }
  const update = useMutation({
    mutationFn: async (patch: Partial<Conversation>) => unwrap(await supabase.from('conversations').update(patch).eq('id', id)),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  })
  const reply = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('messages').insert({
        workspace_id: workspace.id, conversation_id: id, role: 'agent', content: draft.trim(), author_id: session!.user.id,
      })),
    onSuccess: () => {
      setDraft('')
      qc.invalidateQueries({ queryKey: ['messages', id] })
      refresh()
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('conversations').delete().eq('id', id)),
    onSuccess: () => {
      refresh()
      navigate(`${base}/inbox`)
    },
  })

  if (conv.isLoading) return <Loading />
  if (!conv.data) return <Empty title="Conversation not found" />
  const c = conv.data
  const ct = c.contacts
  const lastUserBefore = (i: number) => [...(messages.data ?? [])].slice(0, i).reverse().find((m) => m.role === 'user')?.content ?? ''

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Link to={`${base}/inbox`} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 md:hidden" aria-label="Back to inbox"><ArrowLeft className="size-5" /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold">{contactName(c)}</h2>
              {c.status === 'handoff' ? <Badge tone="warning" dot>Waiting for a person</Badge> : c.status === 'resolved' ? <Badge tone="success" dot>Resolved</Badge> : <Badge tone="primary" dot>Bot answering</Badge>}
            </div>
            <p className="truncate text-xs text-muted">{CHANNEL_LABEL[c.channel]} · {c.bots?.name} · started {dateTime(c.created_at)}</p>
          </div>
          {can('reviewer') && (
            <div className="flex items-center gap-2">
              {c.assigned_to !== session?.user.id && c.status !== 'resolved' && (
                <Button size="sm" icon={<UserCheck />} onClick={() => update.mutate({ assigned_to: session!.user.id, status: 'handoff' })}>Take over</Button>
              )}
              {c.status !== 'resolved' ? (
                <Button size="sm" variant="primary" icon={<CheckCircle2 />} onClick={() => update.mutate({ status: 'resolved' })}>Resolve</Button>
              ) : (
                <Button size="sm" icon={<RotateCcw />} onClick={() => update.mutate({ status: 'open' })}>Reopen</Button>
              )}
              {c.status === 'handoff' && (
                <Button size="sm" variant="ghost" onClick={() => update.mutate({ status: 'open', assigned_to: null })}>Hand back to bot</Button>
              )}
              {can('admin') && (
                <Menu>
                  <MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
                  <MenuContent>
                    <MenuItem danger icon={<Trash2 />} onSelect={async () => {
                      if (await confirm('Delete this conversation?', { body: 'Its messages are deleted for good.' })) remove.mutate()
                    }}>Delete conversation</MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </div>
          )}
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto bg-bg px-4 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {(messages.data ?? []).map((m, i) => {
              if (m.role === 'system') {
                return <p key={m.id} className="self-center rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">{m.content}</p>
              }
              const mine = m.role !== 'user'
              return (
                <div key={m.id} className={cn('flex max-w-[85%] flex-col gap-1.5', mine ? 'self-end items-end' : 'self-start')}>
                  <div className="flex items-center gap-2 text-xs text-subtle">
                    {m.role === 'user' ? contactName(c) : m.role === 'agent' ? (names.data?.get(m.author_id ?? '') ?? 'Team') : 'Bot'}
                    <span>· {timeAgo(m.created_at)}</span>
                  </div>
                  <div className={cn(
                    'rounded-2xl px-4 py-2.5',
                    m.role === 'user' && 'rounded-tl-md border border-border bg-surface',
                    m.role === 'assistant' && 'rounded-tr-md bg-primary-soft',
                    m.role === 'agent' && 'rounded-tr-md bg-primary text-primary-fg',
                  )}>
                    {m.structured ? <LegalCard answer={m.structured} /> : <Markdown text={m.content} citations={m.citations?.length ?? 0} />}
                  </div>
                  {m.role === 'assistant' && (
                    <div className="flex flex-col items-end gap-1.5">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <ConfidenceBadge value={m.confidence} outcome={m.outcome} />
                        {m.model && <span className="text-xs text-subtle">{m.model}{m.latency_ms ? ` · ${(m.latency_ms / 1000).toFixed(1)}s` : ''}</span>}
                        {m.outcome === 'no_answer' && can('editor') && (
                          <Button size="sm" variant="ghost" onClick={() => setGap(lastUserBefore(i))}>Add answer</Button>
                        )}
                      </div>
                      <Sources citations={m.citations ?? []} />
                    </div>
                  )}
                  {m.delivery_status === 'failed' && (
                    <p className="text-xs text-danger">Not delivered{m.delivery_error ? `: ${m.delivery_error}` : ''}</p>
                  )}
                </div>
              )
            })}
            <div ref={endRef} />
          </div>
        </div>

        {can('reviewer') && c.status !== 'resolved' && (
          <form
            className="border-t border-border bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) reply.mutate()
            }}
          >
            {c.status !== 'handoff' && (
              <p className="mb-2 text-xs text-muted">Replying takes over from the bot for this conversation.</p>
            )}
            {c.channel === 'whatsapp' && (
              <Notice tone="info" className="mb-2">WhatsApp only delivers free-form replies within 24 hours of the customer's last message.</Notice>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                aria-label="Reply"
                rows={2}
                className="min-h-[44px] resize-none"
                placeholder={c.channel === 'api' ? 'Reply (the app shows it when it next fetches messages)…' : 'Write a reply…'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    if (draft.trim()) reply.mutate()
                  }
                }}
              />
              <Button type="submit" variant="primary" size="icon" aria-label="Send reply" loading={reply.isPending} disabled={!draft.trim()}>
                <Send />
              </Button>
            </div>
          </form>
        )}
      </div>

      <aside className="hidden w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border p-5 xl:flex">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-surface-3 text-lg font-semibold">{initials(contactName(c))}</span>
          <p className="font-semibold">{contactName(c)}</p>
        </div>
        <dl className="flex flex-col gap-3 text-sm">
          {[
            ['Email', ct?.email],
            ['Phone', ct?.phone],
            ['Channel', CHANNEL_LABEL[c.channel]],
            ['ID', ct?.external_id],
            ['Jurisdiction', c.jurisdiction],
            ['Messages', String(c.message_count)],
            ['Assigned to', c.assigned_to ? names.data?.get(c.assigned_to) ?? 'Teammate' : null],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <dt className="text-xs text-subtle">{k}</dt>
              <dd className="break-all">{v}</dd>
            </div>
          ))}
        </dl>
      </aside>
      <QuickAnswerDialog question={gap ?? ''} open={gap !== null} onOpenChange={(v) => !v && setGap(null)} />
      {confirmEl}
    </div>
  )
}
