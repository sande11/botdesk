/** Turns [n] markers in a model's answer into citation records. */
import type { Citation, LegalAnswer } from '../types.ts'
import type { Retrieved } from './retrieve.ts'

const MARKER = /\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g

export function snippet(text: string, max = 220): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : t.slice(0, max).replace(/\s+\S*$/, '') + '…'
}

/**
 * Keeps markers that point at a real source, renumbers them in order of
 * first use (so the reader sees [1], [2]... ) and returns the citations.
 */
export function resolveCitations(text: string, sources: Retrieved[]): { text: string; citations: Citation[] } {
  const order: number[] = []
  const out = text.replace(MARKER, (_m, list: string) => {
    const nums = list
      .split(/[,;]/)
      .map((n) => Number(n.trim()))
      .filter((n) => n >= 1 && n <= sources.length)
    if (!nums.length) return ''
    return nums
      .map((n) => {
        if (!order.includes(n)) order.push(n)
        return `[${order.indexOf(n) + 1}]`
      })
      .filter((v, i, a) => a.indexOf(v) === i)
      .join('')
  })

  const citations: Citation[] = order.map((n, i) => {
    const s = sources[n - 1]
    return {
      n: i + 1,
      source_id: s.source_id,
      chunk_id: s.chunk_id,
      title: s.title,
      url: s.url,
      citation: s.citation,
      section: s.section,
      snippet: snippet(s.content),
      score: Math.round((s.vector_score ?? s.score) * 1000) / 1000,
    }
  })
  return { text: out.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim(), citations }
}

/** "Employment Act · s. 29" — the label people see for a citation. */
export function citationLabel(c: Pick<Citation, 'title' | 'citation' | 'section'>): string {
  const base = c.citation || c.title
  return c.section && !base.includes(c.section) ? `${base} · ${c.section}` : base
}

/** Removes [n] markers (for SMS) and lists the sources at the end. */
export function plainWithSources(text: string, citations: Citation[], max = 3): string {
  const body = text.replace(/\s*\[\d+\]/g, '').trim()
  if (!citations.length) return body
  const list = citations.slice(0, max).map(citationLabel).join('; ')
  return `${body}\n\nSources: ${list}`
}

/** Parses the legal pack's JSON reply. Lenient about code fences and extra text. */
export function parseLegalJson(raw: string): {
  no_answer: boolean
  summary: string
  points: string[]
  follow_ups: string[]
  see_a_lawyer: boolean
} | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const j = JSON.parse(raw.slice(start, end + 1))
    const strings = (v: unknown, n: number) =>
      Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()).slice(0, n) : []
    return {
      no_answer: j.no_answer === true || (!j.summary && !strings(j.points, 4).length),
      summary: typeof j.summary === 'string' ? j.summary.trim() : '',
      points: strings(j.points, 4),
      follow_ups: strings(j.follow_ups, 3),
      see_a_lawyer: j.see_a_lawyer === true,
    }
  } catch {
    return null
  }
}

/**
 * Builds the legal answer: citations are resolved across summary and points
 * together so numbering is shared.
 */
export function buildLegalAnswer(
  parsed: NonNullable<ReturnType<typeof parseLegalJson>>,
  sources: Retrieved[],
  disclaimer: string,
): { answer: LegalAnswer; text: string; citations: Citation[] } {
  const SEP = '\n␞\n'
  const joined = [parsed.summary, ...parsed.points].join(SEP)
  const { text, citations } = resolveCitations(joined, sources)
  const [summary, ...points] = text.split(SEP.trim()).map((s) => s.trim())
  const answer: LegalAnswer = {
    summary: summary ?? '',
    points: points.filter(Boolean),
    sources: citations.map((c) => ({ n: c.n, title: citationLabel(c), detail: c.snippet, url: c.url })),
    follow_ups: parsed.follow_ups,
    see_a_lawyer: parsed.see_a_lawyer,
    disclaimer,
  }
  const display = [answer.summary, ...answer.points.map((p) => `- ${p}`)].join('\n')
  return { answer, text: display, citations }
}
