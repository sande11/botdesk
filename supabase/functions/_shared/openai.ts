/**
 * OpenAI helpers: embeddings + chat completion.
 */

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!
const EMBED_MODEL    = 'text-embedding-3-small'
const CHAT_MODEL     = 'gpt-4o-mini'

/** Embed a string → 1536-dim vector */
export async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI embed error ${res.status}: ${err}`)
  }
  const data = await res.json()
  return data.data[0].embedding as number[]
}

export interface KBChunk {
  answer: string
  similarity: number
}

/**
 * Synthesize a reply from matched KB chunks using gpt-4o-mini.
 * The system prompt instructs the model to stay grounded in the provided context.
 */
export async function synthesize(
  userMessage: string,
  chunks: KBChunk[],
  botName: string
): Promise<string> {
  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.answer}`)
    .join('\n\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: [
            `You are ${botName}, a helpful support assistant.`,
            'Answer ONLY using the knowledge base context below.',
            'Be concise and friendly. Do not make up information.',
            'If the context doesn\'t fully answer the question, say so.',
            '',
            'Knowledge base context:',
            context,
          ].join('\n'),
        },
        { role: 'user', content: userMessage },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI chat error ${res.status}: ${err}`)
  }
  const data = await res.json()
  return data.choices[0].message.content as string
}
