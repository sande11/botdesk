/** Voyage AI embeddings (voyage-law-2 for legal text). All 1024-d. */
import { postJson } from './fetch.ts'
import type { EmbeddingModel } from './types.ts'

// Models that accept output_dimension; the others are fixed at 1024.
const FLEXIBLE = /^voyage-4/

export function voyageEmbeddings(opts: { apiKey: string; model: string; platformKey: boolean }): EmbeddingModel {
  return {
    provider: 'voyage',
    model: opts.model,
    platformKey: opts.platformKey,
    dims: 1024,
    async embed(texts, kind) {
      const vectors: number[][] = []
      let tokens = 0
      // voyage-law-2 has a smaller context; keep batches modest.
      for (let i = 0; i < texts.length; i += 64) {
        const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 24_000) || ' ')
        const res = await postJson(
          'Voyage',
          'https://api.voyageai.com/v1/embeddings',
          { authorization: `Bearer ${opts.apiKey}` },
          {
            model: opts.model,
            input: batch,
            input_type: kind,
            ...(FLEXIBLE.test(opts.model) ? { output_dimension: 1024 } : {}),
          },
          { timeoutMs: 60_000 },
        )
        const j = await res.json()
        const rows = [...(j.data ?? [])].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
        vectors.push(...rows.map((r: any) => r.embedding as number[]))
        tokens += j.usage?.total_tokens ?? 0
      }
      return { vectors, tokens }
    },
  }
}
