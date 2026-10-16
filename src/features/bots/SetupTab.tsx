import { Info } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.tsx'
import { Card, CardHeader, Notice } from '@/components/ui/display.tsx'
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form.tsx'
import { useModels } from '@/lib/queries.ts'
import { useWorkspace } from '@/lib/session.tsx'
import type { Bot } from '@/lib/types.ts'
import { useUpdateBot } from './BotDetailPage.tsx'

const DEFAULT_DISCLAIMER = 'General legal information, not legal advice. For advice on your situation, talk to a lawyer.'

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="flex flex-col gap-4 border-t border-border px-5 py-5">{children}</div>
    </Card>
  )
}

export function SetupTab({ bot }: { bot: Bot }) {
  const { can, legal: legalWorkspace, workspace, base } = useWorkspace()
  const models = useModels()
  const update = useUpdateBot(bot.id)
  const [d, setD] = useState<Bot>(bot)
  // Start over from the saved bot whenever it changes (e.g. after saving).
  const [saved, setSaved] = useState(bot)
  if (saved !== bot) {
    setSaved(bot)
    setD(bot)
  }
  const dirty = useMemo(() => JSON.stringify(d) !== JSON.stringify(bot), [d, bot])
  const readOnly = !can('editor')

  const set = <K extends keyof Bot>(k: K, v: Bot[K]) => setD((x) => ({ ...x, [k]: v }))
  const policy = (patch: Partial<Bot['answer_policy']>) => setD((x) => ({ ...x, answer_policy: { ...x.answer_policy, ...patch } }))
  const legal = (patch: Partial<Bot['legal']>) => setD((x) => ({ ...x, legal: { ...x.legal, ...patch } }))
  const handoff = (patch: Partial<Bot['handoff']>) => setD((x) => ({ ...x, handoff: { ...x.handoff, ...patch } }))

  const modelValue = d.model.custom_model_id ? `custom:${d.model.custom_model_id}` : `${d.model.provider}:${d.model.model}`
  const catalog = models.data
  const providers = [
    { id: 'anthropic', label: 'Anthropic (Claude)' },
    { id: 'openai', label: 'OpenAI' },
  ]
  const selectedInfo = catalog?.chat.find((m) => `${m.provider}:${m.id}` === modelValue)

  const save = () =>
    update.mutate(
      {
        name: d.name.trim(),
        description: d.description,
        instructions: d.instructions,
        model: d.model,
        answer_policy: d.answer_policy,
        legal: d.legal,
        handoff: d.handoff,
        rate_limit_per_min: d.rate_limit_per_min,
      },
      { onSuccess: () => toast.success('Saved.') },
    )

  return (
    <fieldset disabled={readOnly} className="flex flex-col gap-5 pb-24">
      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="b-name"><Input id="b-name" maxLength={80} value={d.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Description" htmlFor="b-desc" optional hint="For your team; not shown to people.">
            <Input id="b-desc" value={d.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Instructions" description="Tone, scope and rules, in plain words. The bot always answers only from its knowledge.">
        <Textarea
          aria-label="Instructions"
          rows={6}
          value={d.instructions}
          onChange={(e) => set('instructions', e.target.value)}
          placeholder={'Examples:\n- Be friendly and brief. Use the customer\'s name if they give it.\n- Only discuss our products and orders. Politely decline anything else.\n- Prices are in Malawi kwacha.'}
        />
      </Section>

      <Section title="Model" description="Which AI model writes the answers.">
        {catalog?.fake_ai && (
          <Notice tone="warning" title="Fake AI is on">This server runs with BOTDESK_FAKE_AI=1, so answers come from a test model. Turn it off in production.</Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field
            label="Model"
            htmlFor="b-model"
            hint={selectedInfo?.note ?? (d.model.custom_model_id ? 'A fine-tuned or self-hosted model.' : undefined)}
          >
            <Select
              id="b-model"
              value={modelValue}
              onChange={(e) => {
                const v = e.target.value
                if (v.startsWith('custom:')) {
                  const cm = catalog?.custom.find((c) => c.id === v.slice(7))
                  set('model', { ...d.model, provider: cm?.provider ?? 'openai_compatible', model: cm?.model ?? '', custom_model_id: v.slice(7) })
                } else {
                  const [provider, ...rest] = v.split(':')
                  set('model', { ...d.model, provider: provider as Bot['model']['provider'], model: rest.join(':'), custom_model_id: null })
                }
              }}
            >
              {providers.map((p) => (
                <optgroup key={p.id} label={p.label + (catalog && !catalog.providers[p.id]?.available ? ' (add a key)' : '')}>
                  {(catalog?.chat ?? []).filter((m) => m.provider === p.id).map((m) => (
                    <option key={m.id} value={`${m.provider}:${m.id}`}>
                      {m.label}{m.inputPerM != null ? ` · $${m.inputPerM}/$${m.outputPerM} per M tokens` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
              {!!catalog?.custom.length && (
                <optgroup label="Your models">
                  {catalog.custom.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.label} ({c.model})</option>)}
                </optgroup>
              )}
              {!catalog?.chat.some((m) => `${m.provider}:${m.id}` === modelValue) && !d.model.custom_model_id && (
                <option value={modelValue}>{d.model.model} (current)</option>
              )}
            </Select>
          </Field>
          <Field label="Longest answer" htmlFor="b-max" hint="Tokens; about 0.75 words each.">
            <Input id="b-max" type="number" min={128} max={4000} step={50} value={d.model.max_tokens ?? 800}
              onChange={(e) => set('model', { ...d.model, max_tokens: Number(e.target.value) })} />
          </Field>
        </div>
        {catalog && !catalog.providers[d.model.provider]?.available && !d.model.custom_model_id && (
          <Notice tone="warning" icon={<Info />}>
            There's no {d.model.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} key for this workspace yet.
            {can('admin') ? <> Add one in <Link className="font-medium underline" to={`${base}/settings/models`}>Settings → Models</Link>.</> : ' Ask an admin to add one.'}
          </Notice>
        )}
      </Section>

      <Section title="Answers" description="How strictly the bot sticks to your knowledge.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Citations" htmlFor="b-cite">
            <Select id="b-cite" value={d.answer_policy.citations ?? 'required'} onChange={(e) => policy({ citations: e.target.value as 'required' })}>
              <option value="required">Cite sources [1]</option>
              <option value="optional">Cite when useful</option>
              <option value="off">Don't show citations</option>
            </Select>
          </Field>
          <Field label="Sources per answer" htmlFor="b-topk" hint="More context, slower and costlier.">
            <Input id="b-topk" type="number" min={1} max={12} value={d.answer_policy.top_k ?? 6} onChange={(e) => policy({ top_k: Number(e.target.value) })} />
          </Field>
          <Field label="Memory" htmlFor="b-hist" hint="Earlier turns the bot reads.">
            <Input id="b-hist" type="number" min={0} max={20} value={d.answer_policy.history_turns ?? 6} onChange={(e) => policy({ history_turns: Number(e.target.value) })} />
          </Field>
        </div>
        <Field
          label={<span className="flex justify-between">Minimum relevance <span className="font-normal text-muted tabular-nums">{(d.answer_policy.min_score ?? 0.3).toFixed(2)}</span></span>}
          htmlFor="b-min"
          hint="Below this similarity a passage isn't used. Raise it if answers drift off-topic; lower it if the bot says 'not found' too often."
        >
          <input id="b-min" type="range" min={0.1} max={0.7} step={0.01} className="accent-[var(--primary)]"
            value={d.answer_policy.min_score ?? 0.3} onChange={(e) => policy({ min_score: Number(e.target.value) })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="When nothing relevant is found" htmlFor="b-none">
            <Select id="b-none" value={d.answer_policy.on_no_answer ?? 'handoff'} onChange={(e) => policy({ on_no_answer: e.target.value as 'handoff' })}>
              <option value="handoff">Say so and offer a person</option>
              <option value="message">Just say so</option>
            </Select>
          </Field>
          <Field label="What it says" htmlFor="b-fallback" optional>
            <Input id="b-fallback" value={d.answer_policy.fallback_message ?? ''} placeholder="I couldn't find that in the information I have."
              onChange={(e) => policy({ fallback_message: e.target.value })} />
          </Field>
        </div>
        <Switch
          checked={!!d.answer_policy.allow_general_knowledge}
          onChange={(v) => policy({ allow_general_knowledge: v })}
          label="Allow general knowledge"
          description="Lets the model add widely known facts, labelled as general information. Off is safer for legal and policy answers."
        />
      </Section>

      <Section title="Hand-off to people" description="Visitors can ask for a person; replies come from the inbox.">
        <Switch checked={d.handoff.enabled !== false} onChange={(v) => handoff({ enabled: v })} label="Let people ask for a person" />
        {d.handoff.enabled !== false && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Alert email" htmlFor="b-ho-email" optional hint="Emailed when someone is waiting.">
              <Input id="b-ho-email" type="email" value={d.handoff.email ?? ''} onChange={(e) => handoff({ email: e.target.value })} placeholder="support@example.com" />
            </Field>
            <Field label="Confirmation message" htmlFor="b-ho-msg" optional>
              <Input id="b-ho-msg" value={d.handoff.message ?? ''} onChange={(e) => handoff({ message: e.target.value })} placeholder="Thanks! Someone will reply here soon." />
            </Field>
          </div>
        )}
      </Section>

      {legalWorkspace && (
        <Section title="Legal pack" description="Jurisdiction-aware answers with citations, disclaimers and lawyer review.">
          <Switch checked={!!d.legal.enabled} onChange={(v) => legal({ enabled: v })} label="Legal mode" description="Adds plain-language legal rules, a disclaimer, and sends uncertain answers to the review queue." />
          {d.legal.enabled && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Default jurisdiction" htmlFor="b-jur" hint="Apps can pass another one per question.">
                  <Select id="b-jur" value={d.legal.default_jurisdiction ?? ''} onChange={(e) => legal({ default_jurisdiction: e.target.value || undefined })}>
                    <option value="">Any</option>
                    {(workspace.settings.jurisdictions ?? []).map((j) => <option key={j} value={j}>{j}</option>)}
                  </Select>
                </Field>
                <Field label="Answer format" htmlFor="b-fmt" hint="Structured answers suit apps like LegAI; API callers can also ask per request.">
                  <Select id="b-fmt" value={d.legal.answer_format ?? 'text'} onChange={(e) => legal({ answer_format: e.target.value as 'text' })}>
                    <option value="text">Chat text</option>
                    <option value="legal">Structured (summary, points, sources)</option>
                  </Select>
                </Field>
              </div>
              <Field label="Disclaimer" htmlFor="b-disc">
                <Textarea id="b-disc" rows={2} value={d.legal.disclaimer ?? ''} placeholder={DEFAULT_DISCLAIMER} onChange={(e) => legal({ disclaimer: e.target.value })} />
              </Field>
              <Switch
                checked={d.legal.review_low_confidence !== false}
                onChange={(v) => legal({ review_low_confidence: v })}
                label="Send uncertain answers for review"
                description={`Low-confidence answers, unanswered questions and a ${Math.round((workspace.settings.review_sample_rate ?? 0.1) * 100)}% sample go to the review queue.`}
              />
            </>
          )}
        </Section>
      )}

      <Section title="Limits">
        <Field label="Messages per person per minute" htmlFor="b-rate" hint="Stops abuse and runaway costs.">
          <Input id="b-rate" type="number" min={1} max={600} className="max-w-[160px]" value={d.rate_limit_per_min} onChange={(e) => set('rate_limit_per_min', Number(e.target.value))} />
        </Field>
      </Section>

      {dirty && !readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur lg:left-[260px]">
          <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
            <span className="mr-auto text-sm text-muted">You have unsaved changes.</span>
            <Button variant="ghost" onClick={() => setD(bot)}>Discard</Button>
            <Button variant="primary" loading={update.isPending} disabled={!d.name.trim()} onClick={save}>Save changes</Button>
          </div>
        </div>
      )}
    </fieldset>
  )
}
