import { assert, assertEquals } from '@std/assert'
import { buildLegalAnswer, citationLabel, parseLegalJson, plainWithSources, resolveCitations } from './citations.ts'
import type { Retrieved } from './retrieve.ts'
import { isRelevant } from './retrieve.ts'
import { answerSystemPrompt, legalSystemPrompt, sourcesBlock } from './prompt.ts'

const src = (i: number, extra: Partial<Retrieved> = {}): Retrieved => ({
  chunk_id: `c${i}`, source_id: `s${i}`, knowledge_base_id: 'kb', content: `Content number ${i}. More text.`,
  heading: '', section: null, title: `Doc ${i}`, url: null, citation: null, jurisdiction: null, source_type: null,
  vector_score: 0.5, text_score: 0, score: 0.03, ...extra,
})

Deno.test('renumbers citations in order of first use and drops unknown ones', () => {
  const sources = [src(1), src(2), src(3)]
  const { text, citations } = resolveCitations('First [3]. Second [1][3]. Bad [9]. Both [1, 3].', sources)
  assertEquals(text, 'First [1]. Second [2][1]. Bad. Both [2][1].')
  assertEquals(citations.map((c) => c.source_id), ['s3', 's1'])
  assertEquals(citations[0].n, 1)
})

Deno.test('no markers gives no citations', () => {
  const { citations, text } = resolveCitations('Plain answer.', [src(1)])
  assertEquals(citations, [])
  assertEquals(text, 'Plain answer.')
})

Deno.test('SMS text strips markers and lists sources', () => {
  const { text, citations } = resolveCitations('You get notice [1].', [src(1, { citation: 'Employment Act', section: 's. 29' })])
  assertEquals(plainWithSources(text, citations), 'You get notice.\n\nSources: Employment Act · s. 29')
  assertEquals(citationLabel({ title: 'T', citation: null, section: null }), 'T')
})

Deno.test('legal JSON parsing is lenient', () => {
  const raw = '```json\n{"no_answer": false, "summary": "You must get notice [2].", "points": ["In writing [1]", ""], "follow_ups": ["How long?"], "see_a_lawyer": true}\n```'
  const p = parseLegalJson(raw)!
  assertEquals(p.points, ['In writing [1]'])
  assertEquals(p.see_a_lawyer, true)
  const { answer, citations, text } = buildLegalAnswer(p, [src(1, { citation: 'Employment Act', section: 's. 29' }), src(2)], 'Not advice.')
  assertEquals(answer.summary, 'You must get notice [1].')
  assertEquals(answer.points, ['In writing [2]'])
  assertEquals(answer.sources.map((s) => s.title), ['Doc 2', 'Employment Act · s. 29'])
  assertEquals(citations.length, 2)
  assert(text.includes('- In writing [2]'))
  assertEquals(parseLegalJson('nonsense'), null)
  assertEquals(parseLegalJson('{"no_answer": true}')!.no_answer, true)
})

Deno.test('relevance threshold', () => {
  assert(isRelevant({ vector_score: 0.4, text_score: 0 }, 0.3))
  assert(!isRelevant({ vector_score: 0.1, text_score: 0 }, 0.3))
  assert(isRelevant({ vector_score: 0.25, text_score: 0.1 }, 0.3), 'exact-term match lowers the bar')
  assert(isRelevant({ vector_score: null, text_score: 0.2 }, 0.3))
})

Deno.test('prompts fence sources and carry the rules', () => {
  const bot = { name: 'Ava', instructions: 'Be kind.', answer_policy: { citations: 'required' as const } }
  const p = answerSystemPrompt({ bot, workspaceName: 'Acme', channel: 'sms', sources: [src(1)] })
  assert(p.includes('[1] Doc 1'))
  assert(p.includes('NO_ANSWER'))
  assert(p.includes('SMS'))
  assert(p.includes('Be kind.'))
  const l = legalSystemPrompt({ bot, workspaceName: 'LegAI', channel: 'api', sources: [src(1)], jurisdiction: 'MW' })
  assert(l.includes('"MW"'))
  assert(l.includes('"see_a_lawyer"'))
  assertEquals(sourcesBlock([]), '<sources>\n(none)\n</sources>')
})
