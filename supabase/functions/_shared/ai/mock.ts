/**
 * Deterministic stand-ins for real models, for local development and tests
 * (BOTDESK_FAKE_AI=1, or a knowledge base set to the "mock" embedder).
 * Never used in production unless explicitly configured.
 *
 * Embeddings are hashed bags of words, so texts that share words are close.
 * The chat model answers extractively from the sources it is given.
 */
import type { ChatModel, ChatRequest, ChatResult, EmbeddingModel } from './types.ts'

const STOP = new Set(
  ('a an and are as at be by can do does for from has have how i if in is it its me my no not of on or our so ' +
    'that the their them there they this to was we what when where which who why will with you your').split(' '),
)

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, '') || w)
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function mockVector(text: string): number[] {
  const v = new Array(1024).fill(0)
  const ws = words(text)
  for (const w of ws) v[fnv1a(w) % 1024] += 1
  for (let i = 0; i + 1 < ws.length; i++) v[fnv1a(ws[i] + '_' + ws[i + 1]) % 1024] += 0.5
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

export function mockEmbeddings(): EmbeddingModel {
  return {
    provider: 'mock',
    model: 'mock-1024',
    platformKey: false,
    dims: 1024,
    embed(texts) {
      return Promise.resolve({
        vectors: texts.map(mockVector),
        tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
      })
    },
  }
}

function overlap(a: string, b: string): number {
  const A = new Set(words(a))
  if (!A.size) return 0
  let n = 0
  for (const w of new Set(words(b))) if (A.has(w)) n++
  return n / A.size
}

function firstSentences(text: string, n = 2): string {
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+/g) ?? [text.trim()]
  return parts.slice(0, n).join(' ').trim()
}

function reply(req: ChatRequest): string {
  const hint = req.hint
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const question = hint?.question ?? lastUser

  switch (hint?.task) {
    case 'condense':
      return question
    case 'summarize':
      return firstSentences(lastUser, 2) || 'A short conversation.'
    case 'judge': {
      const e = hint.extra ?? {}
      const score = overlap(String(e.expected ?? ''), String(e.answer ?? ''))
      return JSON.stringify({ correctness: Math.min(1, score * 1.5), faithfulness: 1, notes: 'mock judge' })
    }
    case 'analyze_transcript': {
      const text = String(hint.extra?.segment ?? lastUser)
      const best = (hint.sources ?? []).map((s) => ({ s, o: overlap(text, s.content) })).sort((a, b) => b.o - a.o)[0]
      const flags: Record<string, unknown>[] = []
      if (/\b(sign|resign|confess|admit)\b/i.test(text)) {
        flags.push({
          key: 'pressure_to_sign', kind: 'caution', title: "You don't have to sign today.",
          body: 'Ask for a copy and time to read it before you sign anything.', quote: firstSentences(text, 1),
          source: best && best.o > 0 ? best.s.n : null,
        })
      } else if (best && best.o >= 0.3) {
        flags.push({
          key: 'related_law', kind: 'rights', title: `This may be covered by ${best.s.title}.`,
          body: firstSentences(best.s.content, 1), quote: firstSentences(text, 1), source: best.s.n,
        })
      }
      return JSON.stringify({ flags })
    }
    case 'answer':
    case 'legal_answer': {
      const ranked = (hint.sources ?? [])
        .map((s) => ({ s, o: overlap(question, s.content + ' ' + s.title) }))
        .sort((a, b) => b.o - a.o)
      const best = ranked[0]
      if (!best || best.o < 0.15) {
        return hint.task === 'legal_answer'
          ? JSON.stringify({ no_answer: true, summary: '', points: [], follow_ups: [] })
          : 'NO_ANSWER'
      }
      const text = `${firstSentences(best.s.content, 2)} [${best.s.n}]`
      if (hint.task === 'legal_answer') {
        return JSON.stringify({
          no_answer: false,
          summary: text,
          points: ranked.slice(1, 3).filter((r) => r.o > 0).map((r) => `${firstSentences(r.s.content, 1)} [${r.s.n}]`),
          follow_ups: ['What should I do next?'],
          see_a_lawyer: false,
        })
      }
      return text
    }
    default:
      return `You said: ${lastUser}`
  }
}

export function mockChat(model = 'mock-chat'): ChatModel {
  const run = (req: ChatRequest): ChatResult => {
    const text = reply(req)
    return {
      text,
      usage: { inputTokens: Math.ceil((req.system.length + JSON.stringify(req.messages).length) / 4), outputTokens: Math.ceil(text.length / 4) },
      provider: 'mock',
      model,
    }
  }
  return {
    provider: 'mock',
    model,
    platformKey: false,
    complete: (req) => Promise.resolve(run(req)),
    stream(req, onDelta) {
      const result = run(req)
      for (const piece of result.text.match(/\S+\s*/g) ?? []) onDelta(piece)
      return Promise.resolve(result)
    },
  }
}
