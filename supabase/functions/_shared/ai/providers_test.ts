/** Request shapes and stream parsing for each provider, against a fake fetch. */
import { assert, assertEquals } from '@std/assert'
import { anthropicModel } from './anthropic.ts'
import { mockEmbeddings, mockVector } from './mock.ts'
import { compatibleModel, openaiEmbeddings, openaiModel } from './openai.ts'
import { voyageEmbeddings } from './voyage.ts'

type Seen = { url: string; headers: Headers; body: any }

function fakeFetch(respond: (seen: Seen) => Response) {
  const seen: Seen[] = []
  const real = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const s = { url: String(input), headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null }
    seen.push(s)
    return Promise.resolve(respond(s))
  }) as typeof fetch
  return { seen, restore: () => (globalThis.fetch = real) }
}

const sse = (frames: string[]) =>
  new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } })

const REQ = { system: 'Be brief.', messages: [{ role: 'user' as const, content: 'Hi' }], maxTokens: 50 }

Deno.test('Anthropic: request shape and non-streaming reply', async () => {
  const f = fakeFetch(() =>
    Response.json({ content: [{ type: 'text', text: 'Hello' }], usage: { input_tokens: 12, output_tokens: 3 } })
  )
  try {
    const m = anthropicModel({ apiKey: 'sk-ant', model: 'claude-haiku-5-5', platformKey: false })
    const r = await m.complete({ ...REQ, json: true })
    assertEquals(r.text, 'Hello')
    assertEquals(r.usage, { inputTokens: 12, outputTokens: 3 })
    const s = f.seen[0]
    assertEquals(s.url, 'https://api.anthropic.com/v1/messages')
    assertEquals(s.headers.get('x-api-key'), 'sk-ant')
    assertEquals(s.headers.get('anthropic-version'), '2023-06-01')
    assertEquals(s.body.model, 'claude-haiku-5-5')
    assertEquals(s.body.max_tokens, 50)
    assert(s.body.system.includes('single JSON object'))
    assertEquals(s.body.messages, [{ role: 'user', content: 'Hi' }])
    assert(!('temperature' in s.body))
  } finally {
    f.restore()
  }
})

Deno.test('Anthropic: streaming', async () => {
  const f = fakeFetch(() =>
    sse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ])
  )
  try {
    const parts: string[] = []
    const r = await anthropicModel({ apiKey: 'k', model: 'm', platformKey: false }).stream(REQ, (t) => parts.push(t))
    assertEquals(parts, ['Hel', 'lo'])
    assertEquals(r.text, 'Hello')
    assertEquals(r.usage, { inputTokens: 20, outputTokens: 4 })
    assertEquals(f.seen[0].body.stream, true)
  } finally {
    f.restore()
  }
})

Deno.test('OpenAI Responses: request shape, output parsing and streaming', async () => {
  let call = 0
  const f = fakeFetch(() => {
    call++
    if (call === 1) {
      return Response.json({
        output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Hi there' }] }],
        usage: { input_tokens: 9, output_tokens: 2 },
      })
    }
    return sse([
      'event: response.created\ndata: {"type":"response.created"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hi "}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"there"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":9,"output_tokens":2}}}\n\n',
    ])
  })
  try {
    const m = openaiModel({ apiKey: 'sk-o', model: 'gpt-6-luna', platformKey: true })
    const r = await m.complete({ ...REQ, json: true })
    assertEquals(r.text, 'Hi there')
    const s = f.seen[0]
    assertEquals(s.url, 'https://api.openai.com/v1/responses')
    assertEquals(s.headers.get('authorization'), 'Bearer sk-o')
    assertEquals(s.body.instructions, 'Be brief.')
    assertEquals(s.body.input, [{ role: 'user', content: 'Hi' }])
    assertEquals(s.body.max_output_tokens, 50)
    assertEquals(s.body.text, { format: { type: 'json_object' } })
    assertEquals(s.body.store, false)
    const parts: string[] = []
    const r2 = await m.stream(REQ, (t) => parts.push(t))
    assertEquals(parts.join(''), 'Hi there')
    assertEquals(r2.usage, { inputTokens: 9, outputTokens: 2 })
  } finally {
    f.restore()
  }
})

Deno.test('OpenAI-compatible chat completions (Together, vLLM...)', async () => {
  const f = fakeFetch(() =>
    sse([
      'data: {"choices":[{"delta":{"content":"Ok"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ])
  )
  try {
    const m = compatibleModel({ apiKey: 'k', model: 'org/ft-model', baseUrl: 'https://llm.example/v1/', provider: 'openai_compatible', platformKey: false })
    const parts: string[] = []
    const r = await m.stream(REQ, (t) => parts.push(t))
    assertEquals(r.text, 'Ok!')
    assertEquals(r.usage, { inputTokens: 5, outputTokens: 2 })
    assertEquals(f.seen[0].url, 'https://llm.example/v1/chat/completions')
    assertEquals(f.seen[0].body.messages[0], { role: 'system', content: 'Be brief.' })
  } finally {
    f.restore()
  }
})

Deno.test('embeddings: OpenAI asks for 1024 dimensions; Voyage sets input_type', async () => {
  const f = fakeFetch((s) =>
    Response.json({
      data: s.body.input.map((_: string, i: number) => ({ index: i, embedding: new Array(1024).fill(i) })).reverse(),
      usage: { total_tokens: 7 },
    })
  )
  try {
    const o = await openaiEmbeddings({ apiKey: 'k', model: 'text-embedding-3-small', platformKey: false }).embed(['a', 'b'], 'document')
    assertEquals(f.seen[0].body.dimensions, 1024)
    assertEquals(o.vectors[1][0], 1, 'results are put back in input order')
    assertEquals(o.tokens, 7)
    await voyageEmbeddings({ apiKey: 'k', model: 'voyage-law-2', platformKey: false }).embed(['q'], 'query')
    assertEquals(f.seen[1].url, 'https://api.voyageai.com/v1/embeddings')
    assertEquals(f.seen[1].body.input_type, 'query')
    assert(!('output_dimension' in f.seen[1].body), 'voyage-law-2 is fixed at 1024')
    await voyageEmbeddings({ apiKey: 'k', model: 'voyage-4', platformKey: false }).embed(['q'], 'document')
    assertEquals(f.seen[2].body.output_dimension, 1024)
  } finally {
    f.restore()
  }
})

Deno.test('provider errors are explained, and rate limits retried', async () => {
  let n = 0
  const f = fakeFetch(() => {
    n++
    return n === 1
      ? new Response('{"error":{"message":"slow down"}}', { status: 429, headers: { 'retry-after': '0' } })
      : new Response('{"error":{"message":"bad key"}}', { status: 401 })
  })
  try {
    await anthropicModel({ apiKey: 'k', model: 'm', platformKey: false }).complete(REQ)
    throw new Error('should fail')
  } catch (err) {
    assert(String((err as Error).message).includes('rejected the API key'), String(err))
    assertEquals(n, 2)
  } finally {
    f.restore()
  }
})

Deno.test('mock embeddings put related text closer', async () => {
  const { vectors } = await mockEmbeddings().embed(['notice of termination', 'termination notice period', 'pizza toppings'], 'document')
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0)
  assert(dot(vectors[0], vectors[1]) > dot(vectors[0], vectors[2]))
  assertEquals(mockVector('').length, 1024)
})
