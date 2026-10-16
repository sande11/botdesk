/**
 * A tiny, safe Markdown renderer for bot replies. Everything is escaped
 * first; only bold, italics, inline code, http(s) links, lists, paragraphs
 * and citation markers [n] are turned back into HTML.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function inline(s: string, citationCount: number): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?;:]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text: string, url: string) =>
      `<a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`
    )
    .replace(/\[(\d{1,2})\]/g, (m, n: string) =>
      Number(n) >= 1 && Number(n) <= citationCount
        ? `<button type="button" class="bd-cite" data-cite="${n}" aria-label="Source ${n}">${n}</button>`
        : m
    )
}

export function renderMarkdown(text: string, citationCount = 0): string {
  const lines = escapeHtml(text.trim()).split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join('<br>'), citationCount)}</p>`)
    para = []
  }
  const closeList = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushPara()
      const kind = bullet ? 'ul' : 'ol'
      if (list !== kind) {
        closeList()
        out.push(`<${kind}>`)
        list = kind
      }
      out.push(`<li>${inline((bullet ?? numbered)![1], citationCount)}</li>`)
      continue
    }
    if (!line.trim()) {
      flushPara()
      closeList()
      continue
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      flushPara()
      closeList()
      out.push(`<p><strong>${inline(heading[1], citationCount)}</strong></p>`)
      continue
    }
    closeList()
    para.push(line)
  }
  flushPara()
  closeList()
  return out.join('')
}
