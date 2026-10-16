import { assert, assertEquals } from '@std/assert'
import { confidence, isNoAnswer, noAnswerGate, noAnswerText } from './answer.ts'

Deno.test('NO_ANSWER is detected with stray punctuation', () => {
  assert(isNoAnswer('NO_ANSWER'))
  assert(isNoAnswer(' no_answer. '))
  assert(!isNoAnswer('No answer is needed, you can return it [1].'))
})

Deno.test('the stream gate hides a bare NO_ANSWER', () => {
  const seen: string[] = []
  const g = noAnswerGate((t) => seen.push(t))
  for (const t of ['NO', '_ANS', 'WER']) g.push(t)
  assertEquals(seen.join(''), '')
})

Deno.test('the stream gate passes real answers through, early', () => {
  const seen: string[] = []
  const g = noAnswerGate((t) => seen.push(t))
  g.push('You ')
  assertEquals(seen.join(''), 'You ', 'released as soon as it cannot be NO_ANSWER')
  g.push('can ')
  g.push('return it.')
  g.flush()
  assertEquals(seen.join(''), 'You can return it.')
})

Deno.test('the stream gate flushes a short answer', () => {
  const seen: string[] = []
  const g = noAnswerGate((t) => seen.push(t))
  g.push('No.')
  g.flush()
  assertEquals(seen.join(''), 'No.')
})

Deno.test('no-answer text offers a person per channel', () => {
  assertEquals(noAnswerText(undefined, false, 'web'), "I couldn't find that in the information I have.")
  assert(noAnswerText('Not sure.', true, 'sms').endsWith('Reply HUMAN to talk to a person.'))
  assert(noAnswerText('Not sure.', true, 'web').endsWith('talk to a person?'))
  assertEquals(noAnswerText('Not sure.', true, 'api'), 'Not sure.')
})

Deno.test('confidence grows with similarity and citations', () => {
  const k = (v: number) => ({ vector_score: v } as any)
  assert(confidence([k(0.8)], true) > confidence([k(0.8)], false))
  assert(confidence([k(0.8)], true) > confidence([k(0.4)], true))
  assertEquals(confidence([], false), 0.25)
  assert(confidence([k(1)], true) <= 1)
})
