import { assert, assertEquals } from '@std/assert'
import { chunkText, embeddingText, estimateTokens } from './chunker.ts'

Deno.test('keeps markdown headings as context and never mixes sections', () => {
  const text = `# Shipping\n\nWe ship in 3 days.\n\nTracking links are emailed.\n\n# Returns\n\nReturn within 30 days.`
  const chunks = chunkText(text, { targetTokens: 200 })
  assertEquals(chunks.length, 2)
  assertEquals(chunks[0].heading, 'Shipping')
  assert(chunks[0].content.includes('Tracking'))
  assertEquals(chunks[1].heading, 'Returns')
  assert(!chunks[1].content.includes('ship in 3 days'))
})

Deno.test('nested headings form a trail', () => {
  const chunks = chunkText('# Guide\n\n## Billing\n\nPay monthly.', {})
  assertEquals(chunks[0].heading, 'Guide › Billing')
})

Deno.test('legal text: parts and numbered sections become headings with section labels', () => {
  const text = [
    'PART III — TERMINATION OF CONTRACTS',
    '',
    '29. Notice of termination',
    '(1) A contract of employment shall be terminated only after the employer gives notice.',
    '(2) Notice shall be in writing.',
    '',
    '30. Payment in lieu of notice',
    'An employer may pay wages in lieu of notice.',
  ].join('\n')
  const chunks = chunkText(text, { legal: true, targetTokens: 300 })
  assertEquals(chunks.length, 2)
  assertEquals(chunks[0].section, 's. 29')
  assertEquals(chunks[0].heading, 'PART III — TERMINATION OF CONTRACTS › 29. Notice of termination')
  assert(chunks[0].content.includes('Notice shall be in writing'))
  assertEquals(chunks[1].section, 's. 30')
})

Deno.test('legal text: a long numbered section line starts the section body', () => {
  const text = '42. Every person who is arrested shall be informed promptly of the reason for the arrest and shall be entitled to remain silent.'
  const [c] = chunkText(text, { legal: true })
  assertEquals(c.section, 's. 42')
  assert(c.content.startsWith('42. Every person'))
})

Deno.test('numbered lists are not sections outside legal mode', () => {
  const chunks = chunkText('1. Open the app.\n2. Tap Settings.', {})
  assertEquals(chunks.length, 1)
  assertEquals(chunks[0].section, null)
})

Deno.test('long text is split near the target size with overlap', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog near the river bank. '
  const text = sentence.repeat(200)
  const chunks = chunkText(text, { targetTokens: 120, overlapTokens: 30 })
  assert(chunks.length > 5)
  for (const c of chunks) assert(c.tokenCount <= 120 * 1.6, `chunk too big: ${c.tokenCount}`)
  // Overlap: each chunk after the first starts with text from the previous one.
  const end = chunks[0].content.slice(-40)
  assert(chunks[1].content.includes(end.trim().split(' ').slice(-3).join(' ')))
})

Deno.test('a single huge sentence is hard-wrapped', () => {
  const chunks = chunkText('x'.repeat(10_000), { targetTokens: 200 })
  assert(chunks.length >= 10)
})

Deno.test('tiny trailing chunks merge into the previous one', () => {
  const text = 'A'.repeat(1700) + '.\n\nOk.'
  const chunks = chunkText(text, { targetTokens: 450 })
  assertEquals(chunks.length, 1)
})

Deno.test('embedding text includes title and heading', () => {
  assertEquals(embeddingText({ heading: 'Returns', content: 'Within 30 days.' }, 'FAQ'), 'FAQ › Returns\n\nWithin 30 days.')
  assertEquals(estimateTokens('abcd'), 1)
})

Deno.test('empty input gives no chunks', () => {
  assertEquals(chunkText('   \n\n  '), [])
})
