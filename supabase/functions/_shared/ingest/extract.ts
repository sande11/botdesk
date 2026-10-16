/**
 * Turns documents into plain text with Markdown-style headings, which the
 * chunker uses for structure. Formats: HTML, PDF (page by page), DOCX,
 * CSV, Markdown, plain text, JSON.
 */
import { strFromU8, unzipSync } from 'fflate'
import { parseHTML } from 'linkedom'
import { getDocumentProxy } from 'unpdf'
import { PermanentError } from '../jobs.ts'

export type DocKind = 'html' | 'pdf' | 'docx' | 'csv' | 'markdown' | 'text' | 'json'

export function detectKind(contentType: string | null | undefined, name?: string | null): DocKind | null {
  const ct = (contentType ?? '').toLowerCase()
  const ext = (name ?? '').toLowerCase().split('?')[0].split('.').pop() ?? ''
  if (ct.includes('pdf') || ext === 'pdf') return 'pdf'
  if (ct.includes('wordprocessingml') || ext === 'docx') return 'docx'
  if (ct.includes('html') || ext === 'html' || ext === 'htm') return 'html'
  if (ct.includes('csv') || ext === 'csv') return 'csv'
  if (ct.includes('markdown') || ext === 'md' || ext === 'markdown') return 'markdown'
  if (ct.includes('json') || ext === 'json') return 'json'
  if (ct.startsWith('text/') || ext === 'txt') return 'text'
  return null
}

const dec = new TextDecoder('utf-8', { fatal: false })

export function decodeText(bytes: Uint8Array): string {
  // Strip a UTF-8 BOM.
  const b = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes
  return dec.decode(b)
}

export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[  -​  　]/g, ' ')
    .replace(/­/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── HTML ──────────────────────────────────────────────────────────────────

const DROP = 'script,style,noscript,svg,canvas,iframe,form,nav,footer,header,aside,template,button,select,[aria-hidden="true"],[hidden],.cookie,.cookies,#cookie-banner'

export function extractHtml(html: string, baseUrl?: string): { title: string; text: string; links: string[] } {
  const { document } = parseHTML(html) as unknown as { document: any }
  const title =
    document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    document.querySelector('title')?.textContent?.trim() ||
    document.querySelector('h1')?.textContent?.trim() ||
    ''

  const links: string[] = []
  for (const a of document.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href')!, baseUrl)
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        u.hash = ''
        links.push(u.toString())
      }
    } catch {
      // ignore
    }
  }

  for (const el of document.querySelectorAll(DROP)) el.remove()
  const root = document.querySelector('main') ?? document.querySelector('article') ??
    document.querySelector('[role="main"]') ?? document.body ?? document.documentElement

  const out: string[] = []
  walk(root, out)
  return { title: title.replace(/\s+/g, ' ').slice(0, 200), text: cleanText(out.join('')), links: [...new Set(links)] }
}

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'DL', 'FIGURE', 'MAIN', 'BR', 'HR', 'TR', 'DD', 'DT'])

function walk(node: any, out: string[]) {
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === 3) {
      out.push(child.textContent.replace(/\s+/g, ' '))
      continue
    }
    if (child.nodeType !== 1) continue
    const tag = child.tagName
    const h = tag.match(/^H([1-6])$/)
    if (h) {
      const t = child.textContent.replace(/\s+/g, ' ').trim()
      if (t) out.push(`\n\n${'#'.repeat(Number(h[1]))} ${t}\n\n`)
      continue
    }
    if (tag === 'LI') {
      out.push('\n- ')
      walk(child, out)
      continue
    }
    if (tag === 'TR') {
      const cells = [...child.querySelectorAll('th,td')].map((c: any) => c.textContent.replace(/\s+/g, ' ').trim())
      if (cells.some(Boolean)) out.push(`\n| ${cells.join(' | ')} |`)
      continue
    }
    if (tag === 'A') {
      walk(child, out)
      continue
    }
    if (BLOCK.has(tag)) out.push('\n\n')
    walk(child, out)
    if (BLOCK.has(tag)) out.push('\n\n')
  }
}

// ── Sitemaps ──────────────────────────────────────────────────────────────

/** URLs listed in a sitemap or sitemap index (<loc> elements). */
export function sitemapUrls(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'))
  const isIndex = /<sitemapindex/i.test(xml)
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] }
}

// ── PDF ───────────────────────────────────────────────────────────────────

export interface PdfPages {
  totalPages: number
  pages: string[]
}

/** Extracts pages [from, to) (0-based). */
export async function extractPdfPages(bytes: Uint8Array, from: number, to: number): Promise<PdfPages> {
  let pdf
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes))
  } catch (err) {
    throw new PermanentError(`This PDF could not be read (${(err as Error).message}).`)
  }
  const total = pdf.numPages
  const pages: string[] = []
  for (let i = from; i < Math.min(to, total); i++) {
    const page = await pdf.getPage(i + 1)
    const content = await page.getTextContent()
    pages.push(pdfItemsToText(content.items as any[]))
  }
  return { totalPages: total, pages }
}

/** Rebuilds lines from positioned text items. */
export function pdfItemsToText(items: { str: string; hasEOL?: boolean; transform?: number[] }[]): string {
  let out = ''
  let lastY: number | null = null
  for (const it of items) {
    const y = it.transform?.[5] ?? null
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n'
    out += it.str
    if (it.hasEOL) out += '\n'
    lastY = y
  }
  return out
}

/** Drops lines that repeat on most pages (running headers, footers, page numbers). */
export function stripRepeatedLines(pages: string[]): string[] {
  if (pages.length < 4) return pages
  const counts = new Map<string, number>()
  const norm = (l: string) => l.trim().replace(/\d+/g, '#')
  for (const p of pages) {
    for (const l of new Set(p.split('\n').map(norm).filter((l) => l && l.length < 90))) {
      counts.set(l, (counts.get(l) ?? 0) + 1)
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.5))
  return pages.map((p) =>
    p.split('\n').filter((l) => (counts.get(norm(l)) ?? 0) < threshold || !l.trim()).join('\n')
  )
}

// ── DOCX ──────────────────────────────────────────────────────────────────

const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
const unescapeXml = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m])

export function extractDocx(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })
  } catch {
    throw new PermanentError('This Word file could not be opened.')
  }
  const xml = files['word/document.xml']
  if (!xml) throw new PermanentError('This Word file has no document body.')
  const doc = strFromU8(xml)
  const out: string[] = []
  const body = doc.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const rows = [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) =>
      [...r[0].matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((c) => runsText(c[0])).join(' | ')
    )
    return `<w:p><w:r><w:t>${rows.map((r) => `| ${r} |`).join('@@ROW@@')}</w:t></w:r></w:p>`
  })
  for (const m of body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0]
    const text = runsText(p).replaceAll('@@ROW@@', '\n')
    if (!text.trim()) {
      out.push('')
      continue
    }
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? ''
    const level = style.match(/^(?:Heading|Title)(\d)?$/i)
    if (level) out.push(`${'#'.repeat(Number(level[1] ?? 1))} ${text.trim()}`)
    else if (/<w:numPr[\s/>]/.test(p)) out.push(`- ${text.trim()}`)
    else out.push(text)
  }
  return cleanText(out.join('\n\n'))
}

function runsText(xml: string): string {
  return unescapeXml(
    [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
      .map((m) => (m[0] === '<w:tab/>' ? '\t' : m[0] === '<w:br/>' ? '\n' : m[1]))
      .join(''),
  )
}

// ── CSV ───────────────────────────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

/** Each row becomes a small block: "Header: value" lines. FAQ sheets read well. */
export function csvToText(text: string): string {
  const rows = parseCsv(text)
  if (rows.length < 2) return cleanText(text)
  const [head, ...rest] = rows
  const q = head.findIndex((h) => /^(question|q|title)$/i.test(h.trim()))
  const a = head.findIndex((h) => /^(answer|a|response|body)$/i.test(h.trim()))
  return rest
    .map((r) => {
      if (q >= 0 && a >= 0) return `## ${r[q]?.trim()}\n\n${r[a]?.trim()}`
      return head.map((h, i) => (r[i]?.trim() ? `${h.trim()}: ${r[i].trim()}` : '')).filter(Boolean).join('\n')
    })
    .join('\n\n')
}

/** Text for every non-PDF kind (PDFs are paged separately). */
export function extractSimple(kind: Exclude<DocKind, 'pdf'>, bytes: Uint8Array, baseUrl?: string): { title?: string; text: string } {
  switch (kind) {
    case 'docx':
      return { text: extractDocx(bytes) }
    case 'html': {
      const r = extractHtml(decodeText(bytes), baseUrl)
      return { title: r.title, text: r.text }
    }
    case 'csv':
      return { text: csvToText(decodeText(bytes)) }
    case 'json': {
      const raw = decodeText(bytes)
      try {
        return { text: JSON.stringify(JSON.parse(raw), null, 1) }
      } catch {
        return { text: raw }
      }
    }
    default:
      return { text: cleanText(decodeText(bytes)) }
  }
}
