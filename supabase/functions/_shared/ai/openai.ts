/**
 * OpenAI (Responses API), any OpenAI-compatible chat endpoint (Together,
 * Fireworks, vLLM, OpenRouter, fine-tuned models...) and OpenAI embeddings.
 */
import { readSse } from '../http.ts'
import { postJson } from './fetch.ts'
import {
  type ChatModel,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
  type EmbeddingModel,
  ProviderError,
} from './types.ts'

// ── OpenAI Responses API ──────────────────────────────────────────────────

export function openaiModel(opts: { apiKey: string; model: string; baseUrl?: string; platformKey: boolean }): ChatModel {
  const base = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const headers = { authorization: `Bearer ${opts.apiKey}` }

  const body = (req: ChatRequest, stream: boolean) => ({
    model: opts.model,
    instructions: req.system,
    input: req.messages.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: req.maxTokens,
    store: false,
    ...(req.temperature != null ? { temperature: req.temperature } : {}),
    ...(req.json ? { text: { format: { type: 'json_object' } } } : {}),
    ...(stream ? { stream: true } : {}),
  })

  const outputText = (r: any): string => {
    if (typeof r.output_text === 'string') return r.output_text
    return (r.output ?? [])
      .filter((o: any) => o.type === 'message')
      .flatMap((o: any) => o.content ?? [])
      .filter((c: any) => c.type === 'output_text')
      .map((c: any) => c.text)
      .join('')
  }

  return {
    provider: 'openai',
    model: opts.model,
    platformKey: opts.platformKey,

    async complete(req): Promise<ChatResult> {
      const res = await postJson('OpenAI', `${base}/responses`, headers, body(req, false), { signal: req.signal })
      const j = await res.json()
      return {
        text: outputText(j),
        usage: { inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 },
        provider: 'openai',
        model: opts.model,
      }
    },

    async stream(req, onDelta): Promise<ChatResult> {
      const res = await postJson('OpenAI', `${base}/responses`, headers, body(req, true), { signal: req.signal })
      let text = ''
      let usage = { inputTokens: 0, outputTokens: 0 }
      for await (const ev of readSse(res.body!)) {
        let data: any
        try {
          data = JSON.parse(ev.data)
        } catch {
          continue
        }
        const type = data.type ?? ev.event
        if (type === 'response.output_text.delta' && data.delta) {
          text += data.delta
          onDelta(data.delta)
        } else if (type === 'response.completed') {
          const u = data.response?.usage
          usage = { inputTokens: u?.input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0 }
          if (!text) text = outputText(data.response ?? {})
        } else if (type === 'response.failed' || type === 'error') {
          throw new ProviderError('OpenAI', 500, data.response?.error?.message ?? data.message ?? 'stream error', true)
        }
      }
      return { text, usage, provider: 'openai', model: opts.model }
    },
  }
}

// ── OpenAI-compatible chat completions ────────────────────────────────────

export function compatibleModel(opts: {
  apiKey: string
  model: string
  baseUrl: string
  provider: ChatProvider
  platformKey: boolean
}): ChatModel {
  const base = opts.baseUrl.replace(/\/$/, '')
  const headers = { authorization: `Bearer ${opts.apiKey}` }
  const name = opts.provider === 'together' ? 'Together' : 'Model endpoint'

  const body = (req: ChatRequest, stream: boolean) => ({
    model: opts.model,
    messages: [{ role: 'system', content: req.system }, ...req.messages],
    max_tokens: req.maxTokens,
    ...(req.temperature != null ? { temperature: req.temperature } : {}),
    ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  })

  return {
    provider: opts.provider,
    model: opts.model,
    platformKey: opts.platformKey,

    async complete(req): Promise<ChatResult> {
      const res = await postJson(name, `${base}/chat/completions`, headers, body(req, false), { signal: req.signal })
      const j = await res.json()
      return {
        text: j.choices?.[0]?.message?.content ?? '',
        usage: { inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 },
        provider: opts.provider,
        model: opts.model,
      }
    },

    async stream(req, onDelta): Promise<ChatResult> {
      const res = await postJson(name, `${base}/chat/completions`, headers, body(req, true), { signal: req.signal })
      let text = ''
      let usage = { inputTokens: 0, outputTokens: 0 }
      for await (const ev of readSse(res.body!)) {
        if (ev.data === '[DONE]') break
        let data: any
        try {
          data = JSON.parse(ev.data)
        } catch {
          continue
        }
        const delta = data.choices?.[0]?.delta?.content
        if (delta) {
          text += delta
          onDelta(delta)
        }
        if (data.usage) {
          usage = { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 }
        }
      }
      return { text, usage, provider: opts.provider, model: opts.model }
    },
  }
}

// ── OpenAI embeddings (requested at 1024 dimensions) ──────────────────────

export function openaiEmbeddings(opts: { apiKey: string; model: string; platformKey: boolean }): EmbeddingModel {
  return {
    provider: 'openai',
    model: opts.model,
    platformKey: opts.platformKey,
    dims: 1024,
    async embed(texts) {
      const vectors: number[][] = []
      let tokens = 0
      for (let i = 0; i < texts.length; i += 96) {
        const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 24_000) || ' ')
        const res = await postJson(
          'OpenAI',
          'https://api.openai.com/v1/embeddings',
          { authorization: `Bearer ${opts.apiKey}` },
          { model: opts.model, input: batch, dimensions: 1024 },
          { timeoutMs: 60_000 },
        )
        const j = await res.json()
        const rows = [...(j.data ?? [])].sort((a: any, b: any) => a.index - b.index)
        vectors.push(...rows.map((r: any) => r.embedding as number[]))
        tokens += j.usage?.total_tokens ?? 0
      }
      return { vectors, tokens }
    },
  }
}
