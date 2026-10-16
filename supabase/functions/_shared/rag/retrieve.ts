/** Finds the chunks an answer should be grounded in. */
import { embeddingModel } from '../ai/registry.ts'
import type { Db } from '../db.ts'
import { DbError } from '../db.ts'
import type { KnowledgeBaseRow } from '../types.ts'
import { recordUsage } from '../usage.ts'

export interface Retrieved {
  chunk_id: string
  source_id: string
  knowledge_base_id: string
  content: string
  heading: string
  section: string | null
  title: string
  url: string | null
  citation: string | null
  jurisdiction: string | null
  source_type: string | null
  vector_score: number | null
  text_score: number | null
  score: number
}

export interface RetrieveOptions {
  topK: number
  minScore: number
  jurisdiction?: string | null
  sourceTypes?: string[]
  botId?: string | null
}

/**
 * Embeds the query once per distinct embedding model among the knowledge
 * bases, searches each group (hybrid: vector + full text), merges by fused
 * score and keeps chunks that are relevant enough.
 */
export async function retrieve(
  db: Db,
  workspaceId: string,
  kbs: KnowledgeBaseRow[],
  query: string,
  opts: RetrieveOptions,
): Promise<{ kept: Retrieved[]; considered: Retrieved[] }> {
  if (!kbs.length || !query.trim()) return { kept: [], considered: [] }

  const groups = new Map<string, KnowledgeBaseRow[]>()
  for (const kb of kbs) {
    const key = `${kb.embedding_provider}:${kb.embedding_model}`
    groups.set(key, [...(groups.get(key) ?? []), kb])
  }

  const filter: Record<string, unknown> = {}
  if (opts.jurisdiction) filter.jurisdiction = opts.jurisdiction
  if (opts.sourceTypes?.length) filter.source_types = opts.sourceTypes

  const results: Retrieved[] = []
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const model = await embeddingModel(db, workspaceId, group[0].embedding_provider, group[0].embedding_model)
      const { vectors, tokens } = await model.embed([query], 'query')
      recordUsage(db, {
        workspaceId, botId: opts.botId ?? null, kind: 'embedding', provider: model.provider, model: model.model,
        input: tokens, output: 0, platformKey: model.platformKey,
      })
      const { data, error } = await db.rpc('match_chunks', {
        p_kb_ids: group.map((k) => k.id),
        p_embedding: JSON.stringify(vectors[0]),
        p_query: query,
        p_count: Math.max(opts.topK * 2, 8),
        p_filter: filter,
      })
      if (error) throw new DbError(error.message, error.code)
      results.push(...((data ?? []) as Retrieved[]))
    }),
  )

  results.sort((a, b) => b.score - a.score)
  const kept = results.filter((r) => isRelevant(r, opts.minScore)).slice(0, opts.topK)
  return { kept, considered: results.slice(0, opts.topK * 2) }
}

/**
 * Vector similarity decides relevance; a full-text match lowers the bar a
 * little (exact terms like section numbers or product names).
 */
export function isRelevant(r: Pick<Retrieved, 'vector_score' | 'text_score'>, minScore: number): boolean {
  const v = r.vector_score
  const t = r.text_score ?? 0
  if (v == null) return t > 0.05
  if (v >= minScore) return true
  return t > 0 && v >= minScore - 0.1
}
