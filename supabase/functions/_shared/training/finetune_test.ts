import { assert, assertEquals } from '@std/assert'
import { scrubPii, toJsonl } from './finetune.ts'

Deno.test('JSONL: chat format with the system prompt, deduplicated, PII masked', () => {
  const ex = { messages: [{ role: 'user', content: 'Call me on +265 991 234 567 or a@b.mw' }, { role: 'assistant', content: 'Sure.' }] }
  const jsonl = toJsonl('Be brief.', [ex, ex, { messages: [{ role: 'assistant', content: 'orphan' }] }])
  const lines = jsonl.trim().split('\n')
  assertEquals(lines.length, 1)
  const row = JSON.parse(lines[0])
  assertEquals(row.messages[0], { role: 'system', content: 'Be brief.' })
  assertEquals(row.messages[1].content, 'Call me on [phone] or [email]')
  assert(jsonl.endsWith('\n'))
})

Deno.test('no system prompt, no system message; empty datasets give empty files', () => {
  const jsonl = toJsonl('', [{ messages: [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }] }])
  assertEquals(JSON.parse(jsonl).messages.length, 2)
  assertEquals(toJsonl('x', []), '')
})

Deno.test('scrubbing leaves ordinary numbers alone', () => {
  assertEquals(scrubPii('Section 29 gives 30 days.'), 'Section 29 gives 30 days.')
})
