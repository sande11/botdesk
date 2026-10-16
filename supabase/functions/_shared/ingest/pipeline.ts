/**
 * Indexing a source: fetch → extract text → chunk → embed. Runs in the
 * worker as an `ingest_source` job. Long work (big PDFs, thousands of
 * chunks) saves its progress and continues in the next worker run, so it
 * stays inside Edge Function time limits.
 */
import { embeddingModel } from '../ai/registry.ts'
import { sha256Hex } from '../crypto.ts'
import { type Db, must } from '../db.ts'
import { type Budget, type Job, type JobResult, PermanentError } from '../jobs.ts'
import { chunkText, embeddingText } from '../rag/chunker.ts'
import type { KnowledgeBaseRow } from '../types.ts'
import { recordUsage } from '../usage.ts'
import { cleanText, detectKind, extractHtml, extractPdfPages, extractSimple, sitemapUrls, stripRepeatedLines } from './extract.ts'
import { safeFetch } from './fetch.ts'

const LEGAL_TYPES = new Set(['statute', 'regulation', 'case_law', 'constitution'])
const PDF_PAGES_PER_STEP = 15
const EMBED_BATCH = 64
const MAX_SITEMAP_PAGES = 500

interface SourceRow {
  id: string
  workspace_id: string
  knowledge_base_id: string
  kind: 'file' | 'url' | 'sitemap' | 'text' | 'qa'
  title: string
  url: string | null
  storage_path: string | null
  mime_type: string | null
  content: string | null
  question: string | null
  status: string
  checksum: string | null
  chunk_count: number
  source_type: string | null
  metadata: Record<string, unknown>
  parent_id: string | null
}

export async function ingestSource(db: Db, job: Job, budget: Budget): Promise<JobResult> {
  const sourceId = String(job.payload.source_id ?? '')
  const src = await must(db.from('sources').select('*').eq('id', sourceId).maybeSingle()) as SourceRow | null
  if (!src || src.status === 'disabled') return // deleted or switched off meanwhile
  const kb = await must(
    db.from('knowledge_bases').select('*').eq('id', src.knowledge_base_id).single(),
  ) as KnowledgeBaseRow

  try {
    if (src.status !== 'processing') {
      await update(db, src.id, { status: 'processing', error: null })
    }
    const phase = (job.payload.phase as string) ?? 'extract'

    if (phase === 'extract') {
      if (src.kind === 'sitemap') {
        await expandSitemap(db, src)
        return
      }
      const extracted = await extract(db, src, job, budget)
      if ('defer' in extracted) return extracted
      const changed = await rechunk(db, src, kb, extracted.text, extracted.title)
      if (!changed) {
        await update(db, src.id, { status: 'ready', last_indexed_at: new Date().toISOString(), progress: {} })
        return
      }
    }
    return await embedPending(db, src, kb, job, budget)
  } catch (err) {
    const permanent = err instanceof PermanentError
    const lastTry = permanent || job.attempts >= job.max_attempts
    if (lastTry) {
      await update(db, src.id, { status: 'failed', error: friendly(err), progress: {} })
    }
    throw err
  }
}

async function update(db: Db, id: string, patch: Record<string, unknown>) {
  await must(db.from('sources').update(patch).eq('id', id))
}

function friendly(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err)
  return msg.length > 500 ? msg.slice(0, 500) + '…' : msg
}

// ── Extraction ────────────────────────────────────────────────────────────

type Extracted = { text: string; title?: string } | { defer: Record<string, unknown>; delaySeconds?: number }

async function extract(db: Db, src: SourceRow, job: Job, budget: Budget): Promise<Extracted> {
  switch (src.kind) {
    case 'text':
      return { text: cleanText(src.content ?? '') }
    case 'qa': {
      const q = (src.question ?? src.title ?? '').trim()
      const a = (src.content ?? '').trim()
      return { text: q ? `## ${q}\n\n${a}` : a }
    }
    case 'url': {
      if (!src.url) throw new PermanentError('This source has no link.')
      const f = await safeFetch(src.url)
      const kind = detectKind(f.contentType, f.url) ?? 'html'
      if (kind === 'pdf') return await extractPdf(db, src, f.bytes, job, budget)
      return extractSimple(kind, f.bytes, f.url)
    }
    case 'file': {
      if (!src.storage_path) throw new PermanentError('The uploaded file is missing.')
      // Defence in depth (the database checks this too): only this source's own file.
      const name = src.storage_path.split('/').pop() ?? ''
      if (src.storage_path !== `${src.workspace_id}/${src.id}/${name}` || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(name)) {
        throw new PermanentError('The uploaded file path is not valid.')
      }
      const { data, error } = await db.storage.from('sources').download(src.storage_path)
      if (error || !data) throw new Error(`Could not read the uploaded file: ${error?.message ?? 'not found'}`)
      const bytes = new Uint8Array(await data.arrayBuffer())
      const kind = detectKind(src.mime_type, src.storage_path)
      if (!kind) throw new PermanentError('This file type is not supported. Use PDF, Word (.docx), HTML, CSV, Markdown or text.')
      if (kind === 'pdf') return await extractPdf(db, src, bytes, job, budget)
      return extractSimple(kind, bytes)
    }
    default:
      throw new PermanentError(`Unknown source kind ${src.kind}.`)
  }
}

/** Reads a PDF a few pages at a time into source_parts, resuming across runs. */
async function extractPdf(db: Db, src: SourceRow, bytes: Uint8Array, job: Job, budget: Budget): Promise<Extracted> {
  let next = Number(job.payload.next_page ?? 0)
  if (next === 0) await must(db.from('source_parts').delete().eq('source_id', src.id))
  let total = Number(job.payload.total_pages ?? 0)

  while (true) {
    const { totalPages, pages } = await extractPdfPages(bytes, next, next + PDF_PAGES_PER_STEP)
    total = totalPages
    if (pages.length) {
      await must(db.from('source_parts').upsert(pages.map((text, i) => ({ source_id: src.id, part: next + i, text }))))
    }
    next += pages.length
    await update(db, src.id, { progress: { phase: 'extract', page: next, pages: total } })
    if (next >= total || !pages.length) break
    if (budget.left < 25_000) {
      return { defer: { ...job.payload, phase: 'extract', next_page: next, total_pages: total } }
    }
  }

  const parts = await must(db.from('source_parts').select('text').eq('source_id', src.id).order('part')) as { text: string }[]
  const text = cleanText(stripRepeatedLines(parts.map((p) => p.text)).join('\n\n'))
  await must(db.from('source_parts').delete().eq('source_id', src.id))
  if (text.replace(/\s/g, '').length < 20) {
    throw new PermanentError('No text found in this PDF. If it is a scan, run it through OCR first and upload the result.')
  }
  return { text }
}

// ── Chunking ──────────────────────────────────────────────────────────────

/** Replaces the source's chunks. Returns false when the text is unchanged. */
async function rechunk(db: Db, src: SourceRow, kb: KnowledgeBaseRow, text: string, title?: string): Promise<boolean> {
  if (!text.trim()) throw new PermanentError('No text found in this source.')
  const checksum = await sha256Hex(`${kb.embedding_provider}:${kb.embedding_model}:${kb.chunk_tokens}:${kb.chunk_overlap}:${text}`)
  if (checksum === src.checksum && src.chunk_count > 0) {
    const { count } = await db.from('chunks').select('id', { count: 'exact', head: true })
      .eq('source_id', src.id).is('embedding', null)
    if (!count) return false
  }

  const legal = kb.legal || LEGAL_TYPES.has(src.source_type ?? '')
  const chunks = src.kind === 'qa'
    ? [{ content: text, heading: (src.question ?? src.title ?? '').slice(0, 300), section: null, tokenCount: Math.ceil(text.length / 4) }]
    : chunkText(text, { targetTokens: kb.chunk_tokens, overlapTokens: kb.chunk_overlap, legal })
  if (!chunks.length) throw new PermanentError('No text found in this source.')

  await must(db.from('chunks').delete().eq('source_id', src.id))
  for (let i = 0; i < chunks.length; i += 200) {
    await must(db.from('chunks').insert(
      chunks.slice(i, i + 200).map((c, j) => ({
        workspace_id: src.workspace_id,
        knowledge_base_id: src.knowledge_base_id,
        source_id: src.id,
        ordinal: i + j,
        content: c.content,
        heading: c.heading,
        section: c.section,
        token_count: c.tokenCount,
      })),
    ))
  }

  const patch: Record<string, unknown> = {
    checksum,
    chunk_count: chunks.length,
    token_count: chunks.reduce((n, c) => n + c.tokenCount, 0),
    progress: { phase: 'embed', done: 0, total: chunks.length },
  }
  if (!src.title?.trim() && title) patch.title = title.slice(0, 200)
  await update(db, src.id, patch)
  return true
}

// ── Embedding ─────────────────────────────────────────────────────────────

async function embedPending(db: Db, src: SourceRow, kb: KnowledgeBaseRow, job: Job, budget: Budget): Promise<JobResult> {
  const model = await embeddingModel(db, src.workspace_id, kb.embedding_provider, kb.embedding_model)
  const title = src.title || src.url || ''
  while (true) {
    const rows = await must(
      db.from('chunks').select('id, content, heading').eq('source_id', src.id).is('embedding', null)
        .order('ordinal').limit(EMBED_BATCH),
    ) as { id: string; content: string; heading: string }[]
    if (!rows.length) break

    const { vectors, tokens } = await model.embed(rows.map((r) => embeddingText(r, title)), 'document')
    if (vectors.length !== rows.length || vectors.some((v) => v.length !== 1024)) {
      throw new Error(`Embedding model returned ${vectors[0]?.length ?? 0} dimensions; 1024 are needed.`)
    }
    await must(db.rpc('set_chunk_embeddings', {
      p_ids: rows.map((r) => r.id),
      p_embeddings: vectors.map((v) => JSON.stringify(v)),
    }))
    recordUsage(db, {
      workspaceId: src.workspace_id, botId: null, kind: 'embedding', provider: model.provider, model: model.model,
      input: tokens, output: 0, platformKey: model.platformKey,
    })

    const { count } = await db.from('chunks').select('id', { count: 'exact', head: true })
      .eq('source_id', src.id).is('embedding', null)
    await update(db, src.id, { progress: { phase: 'embed', done: src.chunk_count - (count ?? 0), total: src.chunk_count } })
    if (!count) break
    if (budget.left < 15_000) return { defer: { ...job.payload, phase: 'embed' } }
  }

  await update(db, src.id, {
    status: 'ready', error: null, progress: {}, last_indexed_at: new Date().toISOString(),
  })
}

// ── Sitemaps and site crawls ──────────────────────────────────────────────

/**
 * A sitemap source lists pages; each becomes a child "url" source. Given an
 * ordinary page instead, the same-site links on it are used.
 */
async function expandSitemap(db: Db, src: SourceRow) {
  if (!src.url) throw new PermanentError('This source has no link.')
  const maxPages = Math.min(Number(src.metadata?.max_pages ?? 100), MAX_SITEMAP_PAGES)
  const root = new URL(src.url)
  const f = await safeFetch(src.url, { accept: 'application/xml,text/xml,text/html;q=0.9,*/*;q=0.5' })
  const body = new TextDecoder().decode(f.bytes)

  let pages: string[] = []
  if (/<(urlset|sitemapindex)[\s>]/i.test(body)) {
    const first = sitemapUrls(body)
    pages = first.pages
    for (const sm of first.sitemaps.slice(0, 5)) {
      if (pages.length >= maxPages) break
      try {
        const child = await safeFetch(sm, { accept: 'application/xml,text/xml' })
        pages.push(...sitemapUrls(new TextDecoder().decode(child.bytes)).pages)
      } catch (err) {
        console.error('child sitemap failed', sm, (err as Error).message)
      }
    }
  } else {
    pages = [src.url, ...extractHtml(body, f.url).links]
  }

  const sameSite = (u: string) => {
    try {
      const h = new URL(u).hostname
      return h === root.hostname || h.endsWith(`.${root.hostname.replace(/^www\./, '')}`)
    } catch {
      return false
    }
  }
  const wanted = [...new Set(pages.filter(sameSite).filter((u) => !/\.(jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|css|js)(\?|$)/i.test(u)))]
    .slice(0, maxPages)

  const existing = await must(db.from('sources').select('id, url').eq('parent_id', src.id)) as { id: string; url: string }[]
  const have = new Map(existing.map((e) => [e.url, e.id]))
  const fresh = wanted.filter((u) => !have.has(u))
  const gone = existing.filter((e) => !wanted.includes(e.url)).map((e) => e.id)

  for (let i = 0; i < fresh.length; i += 100) {
    await must(db.from('sources').insert(
      fresh.slice(i, i + 100).map((url) => ({
        workspace_id: src.workspace_id,
        knowledge_base_id: src.knowledge_base_id,
        parent_id: src.id,
        kind: 'url',
        url,
        title: '',
        jurisdiction: (src as any).jurisdiction ?? null,
        source_type: src.source_type,
      })),
    ))
  }
  // Pages already known are refreshed; pages no longer listed are removed.
  const keep = existing.filter((e) => wanted.includes(e.url)).map((e) => e.id)
  if (keep.length) await must(db.from('sources').update({ status: 'queued' }).in('id', keep).neq('status', 'disabled'))
  if (gone.length) await must(db.from('sources').delete().in('id', gone))

  await update(db, src.id, {
    status: 'ready',
    error: wanted.length ? null : 'No pages found on this site.',
    chunk_count: 0,
    progress: {},
    metadata: { ...src.metadata, pages: wanted.length },
    last_indexed_at: new Date().toISOString(),
  })
}
