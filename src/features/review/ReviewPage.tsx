/**
 * Review queue: answers with low confidence, a thumbs-down, no answer, or a
 * random sample. A reviewer (for LegAI, a lawyer) approves or corrects them;
 * good answers can be published as verified Q&A and added to training data.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, BookPlus, Check, ClipboardCheck, Database, ExternalLink, Pencil, ThumbsDown, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Page } from '@/components/layout/AppShell.tsx'
import { Markdown, Sources } from '@/components/MessageView.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, Empty, ErrorBox, Loading, Notice, PageHeader, Segmented } from '@/components/ui/display.tsx'
import { Field, Select, Textarea } from '@/components/ui/form.tsx'
import { Dialog } from '@/components/ui/overlay.tsx'
import { unwrap } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { dateTime, timeAgo } from '@/lib/format.ts'
import { useBots, useKnowledgeBases, useMembersById } from '@/lib/queries.ts'
import { useAuth, useWorkspace } from '@/lib/session.tsx'
import { supabase } from '@/lib/supabase.ts'
import type { Dataset, ReviewItem } from '@/lib/types.ts'

type StatusFilter = 'pending' | 'approved' | 'corrected' | 'rejected' | 'all'

const REASON: Record<ReviewItem['reason'], { label: string; tone: 'warning' | 'danger' | 'info' | 'neutral' }> = {
  low_confidence: { label: 'Low confidence', tone: 'warning' },
  negative_feedback: { label: 'Thumbs down', tone: 'danger' },
  no_answer: { label: 'No answer', tone: 'warning' },
  sampled: { label: 'Random sample', tone: 'info' },
  manual: { label: 'Flagged', tone: 'neutral' },
}

const STATUS_LABEL: Record<ReviewItem['status'], string> = { pending: 'To review', approved: 'Approved', corrected: 'Corrected', rejected: 'Rejected' }

const STATUS_TONE: Record<ReviewItem['status'], 'neutral' | 'success' | 'info' | 'danger'> = {
  pending: 'neutral',
  approved: 'success',
  corrected: 'info',
  rejected: 'danger',
}

export default function ReviewPage() {
  const { workspace, can } = useWorkspace()
  const bots = useBots()
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [reason, setReason] = useState('')
  const [bot, setBot] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const items = useQuery({
    queryKey: ['review', workspace.id, status, reason, bot],
    enabled: can('reviewer'),
    queryFn: async () => {
      let q = supabase.from('review_items').select('*').eq('workspace_id', workspace.id).order('created_at', { ascending: status === 'pending' }).limit(200)
      if (status !== 'all') q = q.eq('status', status)
      if (reason) q = q.eq('reason', reason)
      if (bot) q = q.eq('bot_id', bot)
      return unwrap(await q) as ReviewItem[]
    },
  })
  const counts = useQuery({
    queryKey: ['review-counts', workspace.id],
    enabled: can('reviewer'),
    queryFn: async () => {
      const { count } = await supabase.from('review_items').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).eq('status', 'pending')
      return { pending: count ?? 0 }
    },
  })

  const list = useMemo(() => items.data ?? [], [items.data])
  // The chosen item, or the first one when nothing (or something gone) is chosen.
  const active = list.some((i) => i.id === selected) ? selected : list[0]?.id ?? null
  const current = list.find((i) => i.id === active)
  const next = () => {
    const idx = list.findIndex((i) => i.id === active)
    const n = list[idx + 1] ?? list[idx - 1]
    setSelected(n?.id ?? null)
  }

  if (!can('reviewer')) {
    return <Page><Empty icon={<ClipboardCheck />} title="Reviewers only" description="Ask an admin to give you the reviewer role." /></Page>
  }

  return (
    <Page>
      <PageHeader
        title="Review"
        description="Check answers the bot wasn't sure about, or that a customer marked unhelpful. Corrections can become verified answers the bot uses from then on."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pending', label: `To review${counts.data?.pending ? ` ${counts.data.pending}` : ''}` },
            { value: 'approved', label: 'Approved' },
            { value: 'corrected', label: 'Corrected' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-auto">
          <option value="">Any reason</option>
          {(Object.keys(REASON) as ReviewItem['reason'][]).map((r) => <option key={r} value={r}>{REASON[r].label}</option>)}
        </Select>
        {(bots.data?.length ?? 0) > 1 && (
          <Select aria-label="Bot" value={bot} onChange={(e) => setBot(e.target.value)} className="w-auto">
            <option value="">All bots</option>
            {bots.data!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      <ErrorBox error={items.error} />
      {items.isLoading ? (
        <Loading />
      ) : !list.length ? (
        <Card>
          <Empty
            icon={<BadgeCheck />}
            title={status === 'pending' ? 'All caught up' : 'Nothing here'}
            description={status === 'pending' ? 'New answers to check appear here. You can change how often answers are sampled in Settings → Legal.' : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="scroll-thin max-h-[calc(100vh-220px)] overflow-y-auto">
            <ul className="divide-y divide-border">
              {list.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(i.id)}
                    className={cn('flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-2/70', i.id === active && 'bg-primary-soft/60 hover:bg-primary-soft/60')}
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={REASON[i.reason].tone}>{REASON[i.reason].label}</Badge>
                      {status === 'all' && <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>}
                      <span className="ml-auto text-xs text-subtle">{timeAgo(i.created_at)}</span>
                    </div>
                    <p className="line-clamp-2 text-sm font-medium">{i.question || '(no question)'}</p>
                    <p className="line-clamp-1 text-xs text-muted">{bots.data?.find((b) => b.id === i.bot_id)?.name ?? 'Bot'}{i.jurisdiction ? ` · ${i.jurisdiction}` : ''}</p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {current && <ReviewDetail key={current.id} item={current} onDone={next} />}
        </div>
      )}
    </Page>
  )
}

function ReviewDetail({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const { workspace, base, can } = useWorkspace()
  const { session } = useAuth()
  const qc = useQueryClient()
  const members = useMembersById()
  const [editing, setEditing] = useState(false)
  const [corrected, setCorrected] = useState(item.corrected_answer ?? item.answer)
  const [notes, setNotes] = useState(item.notes ?? '')
  const [publish, setPublish] = useState(false)
  const [toDataset, setToDataset] = useState(false)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['review', workspace.id] })
    qc.invalidateQueries({ queryKey: ['review-counts', workspace.id] })
    qc.invalidateQueries({ queryKey: ['nav-counts', workspace.id] })
  }
  const decide = useMutation({
    mutationFn: async (status: ReviewItem['status']) =>
      unwrap(await supabase.from('review_items').update({
        status,
        ...(status === 'pending' ? {} : { corrected_answer: status === 'corrected' ? corrected.trim() : null }),
        notes: notes.trim() || null,
        reviewer_id: status === 'pending' ? null : session!.user.id,
        reviewed_at: status === 'pending' ? null : new Date().toISOString(),
      }).eq('id', item.id)),
    onSuccess: (_, status) => {
      invalidate()
      setEditing(false)
      toast.success({ approved: 'Approved.', corrected: 'Correction saved.', rejected: 'Rejected.', pending: 'Moved back to review.' }[status])
      if (item.status === 'pending' && status !== 'pending') onDone()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // A "no answer" item is only useful once someone has written the answer.
  const gap = item.reason === 'no_answer'
  const reviewed = gap ? item.status === 'corrected' && !!item.corrected_answer?.trim() : item.status === 'approved' || item.status === 'corrected'
  const final = item.status === 'corrected' ? item.corrected_answer ?? '' : item.answer

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone={REASON[item.reason].tone}>{REASON[item.reason].label}</Badge>
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            {item.jurisdiction && <Badge>{item.jurisdiction}</Badge>}
            <span>{dateTime(item.created_at)}</span>
          </div>
          <h2 className="text-lg font-semibold">{item.question || '(no question)'}</h2>
        </div>
        {item.conversation_id && (
          <Link to={`${base}/inbox/${item.conversation_id}`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
            Conversation <ExternalLink className="size-3.5" />
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-5 px-5 py-5">
        {item.reason === 'negative_feedback' && item.notes && !editing && (
          <Notice tone="danger" icon={<ThumbsDown />} title="Customer comment">{item.notes}</Notice>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-muted">The bot answered</h3>
          <div className={cn('rounded-xl border border-border bg-surface-2/50 p-4', item.status === 'corrected' && 'opacity-70')}>
            <Markdown text={item.answer || '_(no answer)_'} citations={item.citations.length} />
          </div>
          <Sources citations={item.citations} />
        </section>

        {item.status === 'corrected' && !editing && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-info">Corrected answer</h3>
            <div className="rounded-xl border border-info/30 bg-info-soft/40 p-4"><Markdown text={item.corrected_answer ?? ''} /></div>
          </section>
        )}

        {editing && (
          <Field label={gap ? 'The answer' : 'Corrected answer'} hint="Write the answer as the bot should have given it. Markdown works.">
            <Textarea autoFocus rows={8} value={corrected} onChange={(e) => setCorrected(e.target.value)} />
          </Field>
        )}

        {(editing || item.status === 'pending') && (
          <Field label="Note for the team" optional>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why it was wrong, which source is missing…" />
          </Field>
        )}

        {item.reviewer_id && (
          <p className="text-xs text-muted">
            Reviewed by {members.data?.get(item.reviewer_id) ?? 'a teammate'} {timeAgo(item.reviewed_at)}
            {item.published_source_id && <> · <BadgeCheck className="inline size-3.5 text-success" /> published as a verified answer</>}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        {editing ? (
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" className="ml-auto" disabled={!corrected.trim()} loading={decide.isPending} onClick={() => decide.mutate('corrected')}>{gap ? 'Save answer' : 'Save correction'}</Button>
          </>
        ) : item.status === 'pending' ? (
          <>
            <Button variant="danger-ghost" icon={<X />} onClick={() => decide.mutate('rejected')} disabled={decide.isPending}>{gap ? 'Dismiss' : 'Reject'}</Button>
            <div className="ml-auto flex gap-2">
              {gap ? (
                <Button variant="primary" icon={<Pencil />} onClick={() => { setCorrected(''); setEditing(true) }}>Write the answer</Button>
              ) : (
                <>
                  <Button icon={<Pencil />} onClick={() => setEditing(true)}>Correct</Button>
                  <Button variant="primary" icon={<Check />} loading={decide.isPending && decide.variables === 'approved'} onClick={() => decide.mutate('approved')}>Approve</Button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => decide.mutate('pending')}>Review again</Button>
            {item.status !== 'rejected' && <Button variant="ghost" icon={<Pencil />} onClick={() => setEditing(true)}>Edit</Button>}
            <div className="ml-auto flex gap-2">
              {reviewed && can('editor') && <Button icon={<Database />} onClick={() => setToDataset(true)}>Add to dataset</Button>}
              {reviewed && !item.published_source_id && (
                <Button variant="primary" icon={<BookPlus />} onClick={() => setPublish(true)}>Publish as verified answer</Button>
              )}
            </div>
          </>
        )}
      </div>
      <PublishDialog item={item} open={publish} onOpenChange={setPublish} onDone={invalidate} />
      <DatasetDialog item={item} answer={final} open={toDataset} onOpenChange={setToDataset} />
    </Card>
  )
}

function PublishDialog({ item, open, onOpenChange, onDone }: { item: ReviewItem; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { workspace } = useWorkspace()
  const kbs = useKnowledgeBases()
  const qc = useQueryClient()
  const [picked, setKb] = useState('')
  const kb = picked || (kbs.data?.find((k) => k.legal) ?? kbs.data?.[0])?.id || ''
  const publish = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('publish_review', { p_review: item.id, p_knowledge_base: kb })),
    onSuccess: () => {
      onDone()
      qc.invalidateQueries({ queryKey: ['sources', kb] })
      qc.invalidateQueries({ queryKey: ['kb-stats', workspace.id] })
      onOpenChange(false)
      toast.success('Published. The bot will use this answer once it is indexed.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Publish as a verified answer"
      description="Adds this question and the reviewed answer to a knowledge base as Q&A, marked as verified."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!kb} loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>
        </>
      }
    >
      <Field label="Knowledge base">
        <Select value={kb} onChange={(e) => setKb(e.target.value)}>
          {kbs.data?.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </Select>
      </Field>
    </Dialog>
  )
}

function DatasetDialog({ item, answer, open, onOpenChange }: { item: ReviewItem; answer: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspace, base } = useWorkspace()
  const qc = useQueryClient()
  const datasets = useQuery({
    queryKey: ['datasets', workspace.id],
    enabled: open,
    queryFn: async () => unwrap(await supabase.from('datasets').select('*').eq('workspace_id', workspace.id).order('created_at')) as Dataset[],
  })
  const [picked, setDs] = useState('')
  const ds = picked || datasets.data?.[0]?.id || ''
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('dataset_examples').insert({
        workspace_id: workspace.id, dataset_id: ds, origin: 'review', origin_id: item.id, approved: true,
        messages: [{ role: 'user', content: item.question }, { role: 'assistant', content: answer }],
      })
      if (error?.code === '23505') return 'exists'
      unwrap({ data: null, error })
      return 'added'
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['dataset-examples', ds] })
      onOpenChange(false)
      toast.success(r === 'exists' ? 'Already in that dataset.' : 'Added to the dataset.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add to a training dataset"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!ds} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
        </>
      }
    >
      {datasets.isLoading ? <Loading /> : !datasets.data?.length ? (
        <p className="text-sm text-muted">No datasets yet. <Link className="font-medium text-primary-text underline" to={`${base}/training`}>Create one in Training</Link>.</p>
      ) : (
        <Field label="Dataset">
          <Select value={ds} onChange={(e) => setDs(e.target.value)}>
            {datasets.data.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
      )}
    </Dialog>
  )
}
