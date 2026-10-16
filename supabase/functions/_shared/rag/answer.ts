/**
 * The answer engine: one grounded reply to one user message. Shared by the
 * public API, the widget, WhatsApp/SMS, the dashboard playground and evals.
 *
 *   question ─▶ standalone query (if it's a follow-up)
 *            ─▶ hybrid retrieval over the bot's knowledge bases
 *            ─▶ no relevant sources? say so (no model call)
 *            ─▶ model answers from numbered sources, citing [n]
 *            ─▶ citations resolved, confidence scored, usage recorded
 */
import { UTILITY_MODEL } from '../ai/catalog.ts'
import { chatModel, type ModelConfig } from '../ai/registry.ts'
import type { ChatMessage, ChatModel, ChatResult, Usage } from '../ai/types.ts'
import type { BotContext } from '../conversations.ts'
import type { Db } from '../db.ts'
import type { Channel, Citation, ConversationRow, LegalAnswer } from '../types.ts'
import { recordUsage } from '../usage.ts'
import { buildLegalAnswer, parseLegalJson, resolveCitations } from './citations.ts'
import {
  answerSystemPrompt,
  CONDENSE_SYSTEM,
  DEFAULT_DISCLAIMER,
  legalSystemPrompt,
  NO_ANSWER,
} from './prompt.ts'
import { type Retrieved, retrieve } from './retrieve.ts'

export type AnswerFormat = 'text' | 'legal'

export interface AnswerRequest {
  db: Db
  ctx: BotContext
  conversation: Pick<ConversationRow, 'id' | 'jurisdiction'> | null
  question: string
  /** Earlier turns, not including `question`. */
  history: ChatMessage[]
  channel: Channel
  format?: AnswerFormat
  jurisdiction?: string | null
  onDelta?: (text: string) => void
  modelOverride?: ModelConfig | null
  /** Count toward usage and the plan's message quota (default true). */
  record?: boolean
}

export interface AnswerResult {
  text: string
  outcome: 'answered' | 'no_answer'
  citations: Citation[]
  legal: LegalAnswer | null
  confidence: number
  offerHandoff: boolean
  disclaimer: string | null
  jurisdiction: string | null
  standaloneQuery: string
  retrieval: {
    source_id: string
    title: string
    section: string | null
    vector_score: number | null
    text_score: number | null
    used: boolean
  }[]
  provider: string
  model: string
  /** True when BotDesk's own provider key paid for the answer. */
  platformKey: boolean
  usage: Usage
  latencyMs: number
}

export function legalMode(ctx: BotContext): boolean {
  return ctx.workspace.features?.legal === true && ctx.bot.legal?.enabled === true
}

export async function answer(req: AnswerRequest): Promise<AnswerResult> {
  const t0 = Date.now()
  const { db, ctx } = req
  const { bot, workspace } = ctx
  const policy = bot.answer_policy ?? {}
  const legal = legalMode(ctx)
  const format: AnswerFormat = req.format ?? (legal && bot.legal?.answer_format === 'legal' ? 'legal' : 'text')
  const jurisdiction = legal
    ? (req.jurisdiction ?? req.conversation?.jurisdiction ?? bot.legal?.default_jurisdiction ??
      workspace.settings?.default_jurisdiction ?? null)
    : (req.jurisdiction ?? null)
  const disclaimer = legal ? (bot.legal?.disclaimer?.trim() || DEFAULT_DISCLAIMER) : null
  const record = req.record !== false
  const modelCfg: ModelConfig = req.modelOverride ?? bot.model
  const model = await chatModel(db, workspace.id, modelCfg)
  const usage: Usage = { inputTokens: 0, outputTokens: 0 }

  // 1. Follow-ups ("what about part-time workers?") need the conversation.
  let standalone = req.question
  if (req.history.some((m) => m.role === 'user')) {
    standalone = await condense(db, workspace.id, model, req.history, req.question)
  }

  // 2. Retrieval.
  const { kept, considered } = await retrieve(db, workspace.id, ctx.kbs, standalone, {
    topK: clamp(policy.top_k ?? 6, 1, 12),
    minScore: policy.min_score ?? 0.3,
    jurisdiction,
    botId: bot.id,
  })
  const retrieval = considered.map((r) => ({
    source_id: r.source_id,
    title: r.title,
    section: r.section,
    vector_score: round(r.vector_score),
    text_score: round(r.text_score),
    used: kept.some((k) => k.chunk_id === r.chunk_id),
  }))

  const finish = (partial: Omit<AnswerResult, 'retrieval' | 'standaloneQuery' | 'latencyMs' | 'usage' | 'disclaimer' | 'jurisdiction' | 'provider' | 'model' | 'platformKey'>, res?: ChatResult): AnswerResult => {
    if (res) {
      usage.inputTokens += res.usage.inputTokens
      usage.outputTokens += res.usage.outputTokens
    }
    if (record) {
      recordUsage(db, {
        workspaceId: workspace.id, botId: bot.id, kind: 'chat', provider: model.provider, model: model.model,
        input: res?.usage.inputTokens ?? 0, output: res?.usage.outputTokens ?? 0, platformKey: model.platformKey, messages: 1,
      })
    }
    return {
      ...partial,
      disclaimer,
      jurisdiction,
      standaloneQuery: standalone,
      retrieval,
      provider: model.provider,
      model: model.model,
      platformKey: model.platformKey,
      usage,
      latencyMs: Date.now() - t0,
    }
  }

  const noAnswer = () => {
    const offerHandoff = bot.handoff?.enabled !== false && policy.on_no_answer !== 'message'
    const text = noAnswerText(policy.fallback_message, offerHandoff, req.channel)
    return {
      text,
      outcome: 'no_answer' as const,
      citations: [],
      legal: format === 'legal'
        ? { summary: text, points: [], sources: [], follow_ups: [], see_a_lawyer: legal, disclaimer: disclaimer ?? '' }
        : null,
      confidence: 0,
      offerHandoff,
    }
  }

  // 3. Nothing relevant: don't spend a model call (unless general answers are allowed).
  if (!kept.length && !policy.allow_general_knowledge) {
    const r = noAnswer()
    req.onDelta?.(r.text)
    return finish(r)
  }

  // 4. Ask the model.
  const promptCtx = { bot, workspaceName: workspace.name, channel: req.channel, sources: kept, jurisdiction }
  const messages: ChatMessage[] = [...req.history, { role: 'user', content: req.question }]
  const maxTokens = clamp(bot.model?.max_tokens ?? 800, 128, 4000)
  const hintSources = kept.map((k, i) => ({ n: i + 1, title: k.title, content: k.content, citation: k.citation }))

  if (format === 'legal') {
    const res = await model.complete({
      system: legalSystemPrompt(promptCtx),
      messages,
      maxTokens: Math.max(maxTokens, 900),
      temperature: bot.model?.temperature ?? null,
      json: true,
      hint: { task: 'legal_answer', question: standalone, sources: hintSources },
    })
    const parsed = parseLegalJson(res.text)
    if (parsed && !parsed.no_answer) {
      const built = buildLegalAnswer(parsed, kept, disclaimer ?? '')
      req.onDelta?.(built.text)
      return finish({
        text: built.text,
        outcome: 'answered',
        citations: built.citations,
        legal: built.answer,
        confidence: confidence(kept, built.citations.length > 0),
        offerHandoff: false,
      }, res)
    }
    if (!parsed && res.text.trim() && !res.text.includes(NO_ANSWER)) {
      // Model ignored the JSON format: keep its prose answer.
      const { text, citations } = resolveCitations(res.text, kept)
      return finish({
        text, outcome: 'answered', citations,
        legal: { summary: text, points: [], sources: [], follow_ups: [], see_a_lawyer: false, disclaimer: disclaimer ?? '' },
        confidence: confidence(kept, citations.length > 0) * 0.8, offerHandoff: false,
      }, res)
    }
    return finish(noAnswer(), res)
  }

  const system = legal ? `${answerSystemPrompt(promptCtx)}\n\n${LEGAL_TEXT_RULES}` : answerSystemPrompt(promptCtx)
  const chatReq = {
    system,
    messages,
    maxTokens,
    temperature: bot.model?.temperature ?? null,
    hint: { task: 'answer' as const, question: standalone, sources: hintSources },
  }
  let res: ChatResult
  if (req.onDelta) {
    const gate = noAnswerGate(req.onDelta)
    res = await model.stream(chatReq, gate.push)
    if (!isNoAnswer(res.text)) gate.flush()
  } else {
    res = await model.complete(chatReq)
  }

  if (isNoAnswer(res.text) || !res.text.trim()) {
    const r = noAnswer()
    req.onDelta?.(r.text)
    return finish(r, res)
  }
  const { text, citations } = resolveCitations(res.text, kept)
  return finish({
    text,
    outcome: 'answered',
    citations,
    legal: null,
    confidence: confidence(kept, citations.length > 0),
    offerHandoff: false,
  }, res)
}

const LEGAL_TEXT_RULES = [
  'Legal information rules:',
  '- Write for someone without legal training: plain words, short sentences.',
  '- Explain what the law says and what the person can do; do not predict the outcome of their case.',
  '- If there is a deadline, a court date, an arrest, an eviction or a lot at stake, suggest talking to a lawyer.',
].join('\n')

async function condense(db: Db, workspaceId: string, fallback: ChatModel, history: ChatMessage[], question: string) {
  const req = {
    system: CONDENSE_SYSTEM,
    messages: [
      {
        role: 'user' as const,
        content: `Conversation:\n${history.slice(-6).map((m) => `${m.role}: ${m.content.slice(0, 600)}`).join('\n')}\n\nLast message: ${question}`,
      },
    ],
    maxTokens: 120,
    hint: { task: 'condense' as const, question },
  }
  try {
    let m: ChatModel
    try {
      m = await chatModel(db, workspaceId, UTILITY_MODEL)
    } catch {
      m = fallback // no key for the utility model's provider: use the bot's model
    }
    const res = await m.complete(req)
    recordUsage(db, {
      workspaceId, botId: null, kind: 'chat', provider: m.provider, model: m.model,
      input: res.usage.inputTokens, output: res.usage.outputTokens, platformKey: m.platformKey,
    })
    const q = res.text.trim().replace(/^["']|["']$/g, '')
    return q && q.length < 600 ? q : question
  } catch (err) {
    console.error('condense failed', (err as Error).message)
    return question
  }
}

export function isNoAnswer(text: string): boolean {
  return text.trim().replace(/[.\s]+$/, '').toUpperCase() === NO_ANSWER ||
    text.trim().toUpperCase().startsWith(NO_ANSWER)
}

/** Holds back the first few characters so a bare NO_ANSWER is never shown. */
export function noAnswerGate(onDelta: (t: string) => void) {
  let buf = ''
  let open = false
  return {
    push(t: string) {
      if (open) return onDelta(t)
      buf += t
      const head = buf.trimStart().toUpperCase()
      if (head.length >= NO_ANSWER.length || !NO_ANSWER.startsWith(head)) {
        if (!head.startsWith(NO_ANSWER)) {
          open = true
          onDelta(buf)
          buf = ''
        }
      }
    },
    flush() {
      if (!open && buf && !buf.trim().toUpperCase().startsWith(NO_ANSWER)) onDelta(buf)
      buf = ''
      open = true
    },
  }
}

export function noAnswerText(fallback: string | undefined, offerHandoff: boolean, channel: Channel): string {
  const base = fallback?.trim() || "I couldn't find that in the information I have."
  if (!offerHandoff) return base
  if (channel === 'sms' || channel === 'whatsapp') return `${base} Reply HUMAN to talk to a person.`
  if (channel === 'web') return `${base} Would you like to talk to a person?`
  return base
}

/** 0–1. Mostly the best vector similarity, plus a bonus for citing. */
export function confidence(kept: Retrieved[], cited: boolean): number {
  const sims = kept.map((k) => k.vector_score ?? 0.45)
  const top = sims.length ? Math.max(...sims) : 0
  return Math.round(clamp(0.25 + 0.6 * top + (cited ? 0.15 : 0), 0, 1) * 100) / 100
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const round = (n: number | null) => (n == null ? null : Math.round(n * 1000) / 1000)
