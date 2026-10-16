/** Shapes an answer for SMS and WhatsApp, which don't render Markdown. */
import { citationLabel } from '../rag/citations.ts'
import type { Citation } from '../types.ts'

export function markdownToWhatsApp(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1: $2')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
}

export function markdownToPlain(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)')
    .replace(/^[ \t]*[-*•][ \t]+/gm, '- ')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
}

export function formatForChannel(
  text: string,
  citations: Citation[],
  channel: 'sms' | 'whatsapp',
  opts: { disclaimer?: string | null; maxChars?: number } = {},
): string {
  const body = text.replace(/\s*\[\d+\]/g, '').trim()
  const sources = citations.slice(0, 3).map(citationLabel)
  if (channel === 'whatsapp') {
    const parts = [markdownToWhatsApp(body)]
    if (sources.length) parts.push(`_Sources: ${sources.join('; ')}_`)
    if (opts.disclaimer) parts.push(`_${opts.disclaimer}_`)
    return truncate(parts.join('\n\n'), opts.maxChars ?? 4000)
  }
  const parts = [markdownToPlain(body)]
  if (sources.length) parts.push(`Sources: ${sources.join('; ')}`)
  if (opts.disclaimer) parts.push(opts.disclaimer)
  return truncate(parts.join('\n\n'), opts.maxChars ?? 1200)
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

/** "HUMAN", "agent", "talk to a person"... */
export function wantsHuman(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '')
  return /^(human|agent|person|operator|staff|support|help me|real person|talk to (a )?(human|person|someone|agent)|speak to (a )?(human|person|someone|agent))$/.test(t)
}
