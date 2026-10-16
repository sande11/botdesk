/**
 * Splits a document into chunks for embedding.
 *
 * - Follows headings (Markdown "#", and for legal text PART/CHAPTER/
 *   SCHEDULE/Article/Section headings and numbered sections like "29. ...").
 * - Packs paragraphs up to ~targetTokens, never across a heading, and
 *   splits long paragraphs at sentence ends.
 * - Repeats the last ~overlapTokens of a chunk at the start of the next one
 *   within the same section, so an answer split across a boundary is found.
 * - Each chunk keeps its heading trail ("Part III › 29. Notice") and, for
 *   legal text, the section label ("s. 29") used in citations.
 */

export interface Chunk {
  content: string
  heading: string
  section: string | null
  tokenCount: number
}

export interface ChunkOptions {
  targetTokens?: number
  overlapTokens?: number
  legal?: boolean
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 4)

interface Block {
  kind: 'heading' | 'para'
  text: string
  level?: number
  section?: string | null
}

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/
const LEGAL_TOP = /^(PART|CHAPTER|TITLE|SCHEDULE|DIVISION)\b[\s\d.:\-–—IVXLC]*.{0,120}$/i
const LEGAL_ARTICLE = /^(Article|Art\.)\s+(\d+[A-Za-z]?)\b.{0,160}$/i
const LEGAL_SECTION_WORD = /^(?:Section|Sec\.)\s+(\d+[A-Za-z]?)\b/i
// "29. Notice of termination" or "29.—(1) An employer..." at the start of a line
const LEGAL_SECTION_NUM = /^(\d{1,4}[A-Z]?)\.\s*(?:[—–-]\s*)?(?:\(1\)\s*)?(?=[A-Z(])/

function toBlocks(text: string, legal: boolean): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    const t = para.join(' ').replace(/\s+/g, ' ').trim()
    if (t) blocks.push({ kind: 'para', text: t })
    para = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const md = line.match(MD_HEADING)
    if (md) {
      flush()
      const sec = legal ? sectionOf(md[2]) : null
      blocks.push({ kind: 'heading', text: md[2].trim(), level: md[1].length, section: sec })
      continue
    }
    if (legal) {
      if (LEGAL_TOP.test(line) && line.length <= 120 && !/[.;]$/.test(line)) {
        flush()
        blocks.push({ kind: 'heading', text: line, level: 1, section: null })
        continue
      }
      const art = line.match(LEGAL_ARTICLE)
      if (art && line.length <= 160) {
        flush()
        blocks.push({ kind: 'heading', text: line, level: 2, section: `Art. ${art[2]}` })
        continue
      }
      const sw = line.match(LEGAL_SECTION_WORD) ?? line.match(LEGAL_SECTION_NUM)
      if (sw) {
        flush()
        // Short lines are titles; long ones are the section's first paragraph.
        if (line.length <= 100 && !/[.;:]$/.test(line.replace(/^\d+[A-Z]?\./, ''))) {
          blocks.push({ kind: 'heading', text: line, level: 2, section: `s. ${sw[1]}` })
        } else {
          blocks.push({ kind: 'heading', text: `s. ${sw[1]}`, level: 2, section: `s. ${sw[1]}` })
          para.push(line)
        }
        continue
      }
    }
    // Lists and table rows keep their own line.
    if (/^([-*•]|\d+[.)])\s+/.test(line) || line.startsWith('|')) {
      flush()
      blocks.push({ kind: 'para', text: line })
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

function sectionOf(title: string): string | null {
  const a = title.match(LEGAL_ARTICLE)
  if (a) return `Art. ${a[2]}`
  const s = title.match(LEGAL_SECTION_WORD) ?? title.match(LEGAL_SECTION_NUM)
  return s ? `s. ${s[1]}` : null
}

function splitSentences(text: string, maxTokens: number): string[] {
  const sentences = text.match(/[^.!?;]+(?:[.!?;]+["')\]]*|$)\s*/g) ?? [text]
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (estimateTokens(s) > maxTokens) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      // A single huge sentence: hard-wrap by characters.
      for (let i = 0; i < s.length; i += maxTokens * 4) out.push(s.slice(i, i + maxTokens * 4).trim())
      continue
    }
    if (estimateTokens(cur + s) > maxTokens && cur.trim()) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

function tail(text: string, tokens: number): string {
  if (tokens <= 0) return ''
  const sentences = text.match(/[^.!?;]+[.!?;]+\s*/g) ?? []
  let out = ''
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (estimateTokens(sentences[i] + out) > tokens) break
    out = sentences[i] + out
  }
  return out.trim()
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? 450
  const overlap = Math.min(opts.overlapTokens ?? 60, Math.floor(target / 3))
  const legal = !!opts.legal
  const blocks = toBlocks(text, legal)

  const chunks: Chunk[] = []
  const trail: { level: number; text: string; section: string | null }[] = []
  let buf: string[] = []
  let carry = ''

  const headingText = () => trail.map((h) => h.text).join(' › ').slice(0, 300)
  const section = () => [...trail].reverse().find((h) => h.section)?.section ?? null

  const emit = () => {
    const body = buf.join('\n\n').trim()
    buf = []
    if (!body) return
    const content = carry ? `${carry}\n\n${body}` : body
    chunks.push({ content, heading: headingText(), section: section(), tokenCount: estimateTokens(content) })
    carry = tail(body, overlap)
  }

  for (const b of blocks) {
    if (b.kind === 'heading') {
      emit()
      carry = ''
      const level = b.level ?? 1
      while (trail.length && trail[trail.length - 1].level >= level) trail.pop()
      trail.push({ level, text: b.text, section: b.section ?? null })
      continue
    }
    const pieces = estimateTokens(b.text) > target ? splitSentences(b.text, target) : [b.text]
    for (const p of pieces) {
      const current = estimateTokens(buf.join('\n\n')) + estimateTokens(carry)
      if (buf.length && current + estimateTokens(p) > target) emit()
      buf.push(p)
    }
  }
  emit()

  // Very short trailing chunks are merged into the previous one.
  const merged: Chunk[] = []
  for (const c of chunks) {
    const prev = merged[merged.length - 1]
    if (prev && c.tokenCount < 40 && prev.heading === c.heading && prev.tokenCount + c.tokenCount <= target * 1.3) {
      prev.content = `${prev.content}\n\n${c.content}`
      prev.tokenCount = estimateTokens(prev.content)
    } else {
      merged.push({ ...c })
    }
  }
  return merged
}

/** Text that is embedded for a chunk: its heading trail adds context. */
export function embeddingText(c: { heading: string; content: string }, title?: string): string {
  const head = [title, c.heading].filter(Boolean).join(' › ')
  return head ? `${head}\n\n${c.content}` : c.content
}
