/**
 * Try a bot before it goes live: chat as a customer on any channel and see
 * which sources were found, which were used, and how sure the bot was.
 */
import { useMutation } from '@tanstack/react-query'
import { ArrowUp, Check, Ear, FlaskConical, Gauge, HelpCircle, MessageSquare, Minus, Plus, RotateCcw, Scale, Search, Sparkles, TriangleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ConfidenceBadge, LegalCard, Markdown, Sources, citationLabel } from '@/components/MessageView.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Badge, Card, CardHeader, Empty, Notice, Segmented, Spinner } from '@/components/ui/display.tsx'
import { Field, Input, Select, Textarea } from '@/components/ui/form.tsx'
import { Tip } from '@/components/ui/overlay.tsx'
import { admin } from '@/lib/api.ts'
import { cn } from '@/lib/cn.ts'
import { formatForChannel, smsSegments } from '@/lib/channelFormat.ts'
import { num } from '@/lib/format.ts'
import { useModels } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import type { AnswerResult, Bot, Flag } from '@/lib/types.ts'
import { QuickAnswerDialog } from '../knowledge/QuickAnswerDialog.tsx'

type TestChannel = 'web' | 'whatsapp' | 'sms'

interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  channel: TestChannel
  result?: AnswerResult
  error?: string
  question?: string
}

export function PlaygroundTab({ bot }: { bot: Bot }) {
  const { legal } = useWorkspace()
  const isLegal = legal && bot.legal?.enabled === true
  const [mode, setMode] = useState<'chat' | 'listen'>('chat')
  return (
    <div className="flex flex-col gap-4">
      {isLegal && (
        <Segmented
          value={mode}
          onChange={setMode}
          className="self-start"
          options={[
            { value: 'chat', label: <span className="inline-flex items-center gap-1.5"><MessageSquare className="size-3.5" />Chat</span> },
            { value: 'listen', label: <span className="inline-flex items-center gap-1.5"><Ear className="size-3.5" />Listen In</span> },
          ]}
        />
      )}
      {mode === 'chat' || !isLegal ? <ChatTester bot={bot} isLegal={isLegal} /> : <ListenInTester bot={bot} />}
    </div>
  )
}

// ── Chat ──────────────────────────────────────────────────────────────────

function ChatTester({ bot, isLegal }: { bot: Bot; isLegal: boolean }) {
  const { workspace } = useWorkspace()
  const models = useModels()
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [channel, setChannel] = useState<TestChannel>('web')
  const [model, setModel] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [format, setFormat] = useState<'' | 'legal' | 'text'>('')
  const [gap, setGap] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const send = useMutation({
    mutationFn: async (message: string) => {
      const history = turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.result?.text ?? t.content }))
      const override = model.startsWith('custom:')
        ? { custom_model_id: model.slice(7) }
        : model ? { provider: model.split(':')[0], model: model.split(':').slice(1).join(':') } : null
      return admin<{ result: AnswerResult }>('/playground', {
        json: { bot_id: bot.id, message, history, channel, format: format || undefined, jurisdiction: jurisdiction || undefined, model_override: override },
      })
    },
    onMutate: (message) => {
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: 'user', content: message, channel }])
      setDraft('')
    },
    onSuccess: ({ result }, message) => {
      const id = crypto.randomUUID()
      setTurns((t) => [...t, { id, role: 'assistant', content: result.text, result, channel, question: message }])
      setSelected(id)
    },
    onError: (e, message) => {
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: 'assistant', content: '', error: (e as Error).message, channel, question: message }])
    },
  })

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, send.isPending])

  const submit = () => {
    const m = draft.trim()
    if (!m || send.isPending) return
    send.mutate(m)
  }

  const inspected = turns.find((t) => t.id === selected) ?? [...turns].reverse().find((t) => t.result)
  const suggestions = bot.widget.suggested_questions?.length
    ? bot.widget.suggested_questions
    : isLegal
      ? ['What are my rights if I am arrested?', 'Can my landlord evict me without notice?', 'How do I report a crime?']
      : ['What do you do?', 'How can I contact you?', 'What are your opening hours?']
  const jurisdictions = workspace.settings.jurisdictions ?? []
  const catalog = models.data

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="flex h-[calc(100dvh-250px)] min-h-[520px] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Segmented<TestChannel>
            value={channel}
            onChange={setChannel}
            options={[{ value: 'web', label: 'Website' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'sms', label: 'SMS' }]}
          />
          <Select aria-label="Model" className="h-8 w-auto max-w-[240px] text-[13px]" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Bot's model ({bot.model.model || 'custom'})</option>
            {(['anthropic', 'openai'] as const).map((p) => {
              const list = (catalog?.chat ?? []).filter((m) => m.provider === p && m.available)
              return list.length ? (
                <optgroup key={p} label={p === 'anthropic' ? 'Compare with Claude' : 'Compare with OpenAI'}>
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
          {isLegal && (
            <>
              <Select aria-label="Jurisdiction" className="h-8 w-auto text-[13px]" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
                <option value="">Jurisdiction: {bot.legal?.default_jurisdiction || workspace.settings.default_jurisdiction || 'default'}</option>
                {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
              </Select>
              <Select aria-label="Answer format" className="h-8 w-auto text-[13px]" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                <option value="">Format: bot default</option>
                <option value="legal">Structured (app)</option>
                <option value="text">Plain text</option>
              </Select>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            icon={<RotateCcw />}
            disabled={!turns.length || send.isPending}
            onClick={() => {
              setTurns([])
              setSelected(null)
            }}
          >
            Reset
          </Button>
        </div>

        <div ref={listRef} className={cn('scroll-thin flex flex-1 flex-col gap-4 overflow-y-auto p-5', channel === 'whatsapp' && 'bg-[#efeae2] dark:bg-[#0b141a]')}>
          {!turns.length && (
            <Empty
              icon={<FlaskConical />}
              title="Test your bot"
              description="Ask what your customers would ask. Nothing here is saved to the inbox, and tests count toward your monthly messages only when they use BotDesk's AI keys."
              action={
                <div className="flex max-w-lg flex-wrap justify-center gap-2">
                  {suggestions.slice(0, 4).map((q) => (
                    <button key={q} type="button" onClick={() => send.mutate(q)} className="rounded-full border border-border bg-surface px-3 py-1.5 text-[13px] hover:border-border-strong hover:bg-surface-2">
                      {q}
                    </button>
                  ))}
                </div>
              }
            />
          )}
          {turns.map((t) =>
            t.role === 'user' ? (
              <UserBubble key={t.id} turn={t} />
            ) : (
              <BotBubble
                key={t.id}
                turn={t}
                bot={bot}
                selected={inspected?.id === t.id}
                onSelect={() => setSelected(t.id)}
                onAddAnswer={() => setGap(t.question ?? '')}
              />
            ),
          )}
          {send.isPending && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Spinner /> Searching knowledge and writing an answer…
            </div>
          )}
        </div>

        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Textarea
            aria-label="Message"
            rows={1}
            value={draft}
            placeholder={channel === 'web' ? 'Ask something…' : `Send a ${channel === 'sms' ? 'text' : 'WhatsApp message'}…`}
            className="max-h-40 min-h-9 resize-none py-1.5"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <Button type="submit" variant="primary" size="icon" aria-label="Send" disabled={!draft.trim()} loading={send.isPending} icon={<ArrowUp />} />
        </form>
      </Card>

      <Inspector turn={inspected} bot={bot} isLegal={isLegal} />
      <QuickAnswerDialog question={gap ?? ''} open={gap !== null} onOpenChange={(v) => !v && setGap(null)} />
    </div>
  )
}

function UserBubble({ turn }: { turn: Turn }) {
  const phone = turn.channel !== 'web'
  return (
    <div
      className={cn(
        'max-w-[78%] self-end rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-wrap',
        phone ? (turn.channel === 'whatsapp' ? 'bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]' : 'bg-info text-white') : 'bg-primary text-primary-fg',
      )}
    >
      {turn.content}
    </div>
  )
}

function BotBubble({ turn, bot, selected, onSelect, onAddAnswer }: { turn: Turn; bot: Bot; selected: boolean; onSelect: () => void; onAddAnswer: () => void }) {
  const r = turn.result
  if (turn.error) {
    return (
      <div className="flex max-w-[86%] items-start gap-2 rounded-2xl rounded-bl-md border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>{turn.error}</span>
      </div>
    )
  }
  if (!r) return null
  const phone = turn.channel !== 'web'
  const text = phone ? formatForChannel(r.text, r.citations, turn.channel as 'sms' | 'whatsapp', r.disclaimer) : r.text
  return (
    <div className="flex max-w-[86%] flex-col gap-1.5 self-start">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'rounded-2xl rounded-bl-md px-3.5 py-2.5 text-left transition-shadow',
          phone
            ? turn.channel === 'whatsapp' ? 'bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]' : 'bg-surface-2'
            : 'border border-border bg-surface',
          selected ? 'ring-2 ring-primary/60' : 'hover:ring-2 hover:ring-border-strong',
        )}
      >
        {phone ? (
          <div className="text-sm whitespace-pre-wrap">{text}</div>
        ) : r.legal && r.outcome === 'answered' ? (
          <LegalCard answer={r.legal} />
        ) : (
          <Markdown text={r.text} citations={r.citations.length} />
        )}
        {!phone && r.disclaimer && <p className="mt-2 text-xs text-muted">{r.disclaimer}</p>}
      </button>
      <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted">
        <ConfidenceBadge value={r.confidence} outcome={r.outcome} />
        {r.offerHandoff && <Badge tone="info">Offers a person</Badge>}
        {turn.channel === 'sms' && <span>{smsSegments(text)} SMS segment{smsSegments(text) > 1 ? 's' : ''}</span>}
        <span className="tabular-nums">{(r.latencyMs / 1000).toFixed(1)}s</span>
        {r.outcome === 'no_answer' && (
          <button type="button" onClick={onAddAnswer} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline">
            <Plus className="size-3" /> Add the answer
          </button>
        )}
        {!phone && !!r.citations.length && bot.widget.show_sources === false && <span>Sources hidden in the widget</span>}
      </div>
    </div>
  )
}

// ── Inspector ─────────────────────────────────────────────────────────────

function Inspector({ turn, bot, isLegal }: { turn: Turn | undefined; bot: Bot; isLegal: boolean }) {
  const r = turn?.result
  const minScore = bot.answer_policy.min_score ?? 0.3
  return (
    <Card className="flex h-fit flex-col xl:sticky xl:top-4 xl:max-h-[calc(100dvh-250px)]">
      <CardHeader title="Why this answer" description={r ? 'Click any reply in the chat to inspect it.' : undefined} />
      {!r ? (
        <Empty icon={<Search />} title="Nothing to inspect yet" description="Send a message to see what the bot searched for, which sources it found and how sure it was." />
      ) : (
        <div className="scroll-thin flex flex-col gap-5 overflow-y-auto px-5 pb-5">
          <div className="grid grid-cols-2 gap-2">
            <Fact label="Outcome" value={r.outcome === 'answered' ? 'Answered' : 'Not in knowledge'} tone={r.outcome === 'answered' ? 'success' : 'warning'} />
            <Fact label="Confidence" value={`${Math.round(r.confidence * 100)}%`} />
            <Fact label="Model" value={<span className="truncate">{r.model}</span>} sub={r.provider} />
            <Fact label="Time" value={`${(r.latencyMs / 1000).toFixed(2)}s`} sub={`${num(r.usage.inputTokens)} in · ${num(r.usage.outputTokens)} out`} />
          </div>

          <Section title="Searched for" hint="Follow-up questions are rewritten into a standalone question before searching.">
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px]">{r.standaloneQuery}</p>
            {turn?.question && r.standaloneQuery.trim() !== turn.question.trim() && (
              <p className="mt-1.5 text-xs text-muted">Rewritten from “{turn.question}”.</p>
            )}
            {isLegal && r.jurisdiction && <p className="mt-1.5 text-xs text-muted">Jurisdiction filter: <b>{r.jurisdiction}</b> (plus sources with no jurisdiction)</p>}
          </Section>

          <Section
            title={`Found ${r.retrieval.length} passage${r.retrieval.length === 1 ? '' : 's'}`}
            hint={`Passages scoring at least ${minScore} are sent to the model. Change this under Setup → Answers.`}
          >
            {!r.retrieval.length ? (
              <Notice tone="warning" icon={<HelpCircle />}>No passages matched. Add a source that covers this question, or check that the knowledge base is switched on for this bot.</Notice>
            ) : (
              <ol className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {r.retrieval.map((x, i) => (
                  <li key={`${x.source_id}-${i}`} className="flex items-start gap-2.5 px-3 py-2.5">
                    <Tip content={x.used ? 'Sent to the model' : 'Below the minimum score, not used'}>
                      <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md', x.used ? 'bg-success-soft text-success' : 'bg-surface-2 text-subtle')}>
                        {x.used ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}
                      </span>
                    </Tip>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{citationLabel({ title: x.title, citation: null, section: x.section })}</p>
                      <div className="mt-1 flex gap-3">
                        <ScoreBar label="Meaning" value={x.vector_score} />
                        <ScoreBar label="Keywords" value={x.text_score} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {!!r.citations.length && (
            <Section title="Cited in the answer">
              <Sources citations={r.citations} defaultOpen />
            </Section>
          )}

          {r.legal && r.outcome === 'answered' && (
            <Section title="Structured answer" hint="What the LegAI app receives from /v1/chat with format=legal.">
              <div className="flex flex-col gap-2 rounded-xl border border-border p-3 text-[13px]">
                <div className="flex items-center gap-2">
                  <Scale className="size-4 text-muted" />
                  <span>{r.legal.points.length} key point{r.legal.points.length === 1 ? '' : 's'} · {r.legal.follow_ups.length} follow-up{r.legal.follow_ups.length === 1 ? '' : 's'}</span>
                </div>
                <p className="text-muted">See a lawyer: <b className="text-fg">{r.legal.see_a_lawyer ? 'yes' : 'no'}</b></p>
              </div>
            </Section>
          )}
        </div>
      )}
    </Card>
  )
}

function Fact({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'success' | 'warning' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-surface-2 px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn('truncate text-sm font-semibold', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</span>
      {sub && <span className="truncate text-xs text-subtle">{sub}</span>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <h4 className="text-[13px] font-semibold">{title}</h4>
        {hint && (
          <Tip content={hint}>
            <button type="button" aria-label="More info" className="text-subtle hover:text-fg"><HelpCircle className="size-3.5" /></button>
          </Tip>
        )}
      </div>
      {children}
    </section>
  )
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{value == null ? '—' : value.toFixed(2)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }} />
      </div>
    </div>
  )
}

// ── Listen In (legal) ─────────────────────────────────────────────────────

const SAMPLE_TRANSCRIPT = `Officer: You need to come with us to the station now.
Me: Why? What am I being charged with?
Officer: We'll explain at the station. Give me your phone.`

const FLAG_STYLE: Record<Flag['kind'], { label: string; tone: 'info' | 'warning' | 'success'; icon: ReactNode }> = {
  rights: { label: 'Your rights', tone: 'info', icon: <Scale className="size-3.5" /> },
  caution: { label: 'Be careful', tone: 'warning', icon: <TriangleAlert className="size-3.5" /> },
  next_step: { label: 'Next step', tone: 'success', icon: <Sparkles className="size-3.5" /> },
}

function ListenInTester({ bot }: { bot: Bot }) {
  const { workspace } = useWorkspace()
  const [text, setText] = useState('')
  const [topic, setTopic] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const analyze = useMutation({
    mutationFn: () =>
      admin<{ flags: Flag[]; model: string }>('/playground/analyze', {
        json: { bot_id: bot.id, text, topic: topic || undefined, jurisdiction: jurisdiction || undefined },
      }),
    onError: (e) => toast.error((e as Error).message),
  })
  const flags = analyze.data?.flags
  const grouped = useMemo(() => {
    const g: Record<Flag['kind'], Flag[]> = { rights: [], caution: [], next_step: [] }
    for (const f of flags ?? []) g[f.kind]?.push(f)
    return g
  }, [flags])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Listen In"
          description="LegAI transcribes a conversation on the phone and sends it here in short segments. The bot flags rights, cautions and next steps, each grounded in your legal sources."
        />
        <div className="flex flex-col gap-4 px-5 pb-5">
          <Field label="Transcript segment" hint="A few lines of what was said. In the app this comes from on-device speech recognition.">
            <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE_TRANSCRIPT} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Topic" optional hint="e.g. arrest, tenancy, employment">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="arrest" />
            </Field>
            <Field label="Jurisdiction">
              <Select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
                <option value="">{bot.legal?.default_jurisdiction || workspace.settings.default_jurisdiction || 'Default'}</option>
                {(workspace.settings.jurisdictions ?? []).map((j) => <option key={j} value={j}>{j}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Gauge />} loading={analyze.isPending} disabled={!text.trim()} onClick={() => analyze.mutate()}>
              Analyze segment
            </Button>
            {!text && (
              <Button variant="ghost" onClick={() => { setText(SAMPLE_TRANSCRIPT); setTopic('arrest') }}>Use a sample</Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="h-fit">
        <CardHeader title="Flags" description={analyze.data ? `From ${analyze.data.model}` : 'What the app would show the person while they listen.'} />
        {!flags ? (
          <Empty icon={<Ear />} title="No analysis yet" description="Paste a few lines and analyze them." />
        ) : !flags.length ? (
          <Empty icon={<Check />} title="Nothing to flag" description="The bot found nothing in your sources that applies to this segment." />
        ) : (
          <div className="flex flex-col gap-4 px-5 pb-5">
            {(Object.keys(grouped) as Flag['kind'][]).filter((k) => grouped[k].length).map((k) => (
              <div key={k} className="flex flex-col gap-2">
                <Badge tone={FLAG_STYLE[k].tone} className="self-start">{FLAG_STYLE[k].icon}{FLAG_STYLE[k].label}</Badge>
                {grouped[k].map((f) => (
                  <div key={f.key} className="rounded-xl border border-border p-3">
                    <p className="text-sm font-semibold">{f.title}</p>
                    <p className="mt-1 text-[13px] text-fg/85">{f.body}</p>
                    {f.quote && <p className="mt-2 border-l-2 border-border-strong pl-2 text-xs text-muted italic">“{f.quote}”</p>}
                    {f.citation && <p className="mt-2 text-xs font-medium text-primary-text">{f.citation}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
