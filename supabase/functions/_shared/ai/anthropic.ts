/** Claude via the Anthropic Messages API. */
import { readSse } from '../http.ts'
import { postJson } from './fetch.ts'
import { type ChatModel, type ChatRequest, type ChatResult, ProviderError } from './types.ts'

const VERSION = '2023-06-01'

export function anthropicModel(opts: { apiKey: string; model: string; baseUrl?: string; platformKey: boolean }): ChatModel {
  const base = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')
  const headers = { 'x-api-key': opts.apiKey, 'anthropic-version': VERSION }

  const body = (req: ChatRequest, stream: boolean) => {
    const system = req.json
      ? `${req.system}\n\nReply with a single JSON object and nothing else.`
      : req.system
    return {
      model: opts.model,
      max_tokens: req.maxTokens,
      system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
      ...(stream ? { stream: true } : {}),
    }
  }

  return {
    provider: 'anthropic',
    model: opts.model,
    platformKey: opts.platformKey,

    async complete(req): Promise<ChatResult> {
      const res = await postJson('Anthropic', `${base}/v1/messages`, headers, body(req, false), { signal: req.signal })
      const j = await res.json()
      const text = (j.content ?? [])
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('')
      return {
        text,
        usage: { inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 },
        provider: 'anthropic',
        model: opts.model,
      }
    },

    async stream(req, onDelta): Promise<ChatResult> {
      const res = await postJson('Anthropic', `${base}/v1/messages`, headers, body(req, true), { signal: req.signal })
      let text = ''
      let inputTokens = 0
      let outputTokens = 0
      for await (const ev of readSse(res.body!)) {
        let data: any
        try {
          data = JSON.parse(ev.data)
        } catch {
          continue
        }
        switch (data.type) {
          case 'message_start':
            inputTokens = data.message?.usage?.input_tokens ?? 0
            outputTokens = data.message?.usage?.output_tokens ?? 0
            break
          case 'content_block_delta':
            if (data.delta?.type === 'text_delta' && data.delta.text) {
              text += data.delta.text
              onDelta(data.delta.text)
            }
            break
          case 'message_delta':
            outputTokens = data.usage?.output_tokens ?? outputTokens
            break
          case 'error':
            throw new ProviderError('Anthropic', 500, data.error?.message ?? 'stream error', true)
        }
      }
      return { text, usage: { inputTokens, outputTokens }, provider: 'anthropic', model: opts.model }
    },
  }
}
