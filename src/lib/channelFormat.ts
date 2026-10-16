/**
 * How an answer looks on SMS and WhatsApp. Mirrors
 * supabase/functions/_shared/channels/format.ts so the playground preview
 * matches what the channel webhook actually sends.
 */
import { citationLabel } from '@/components/MessageView.tsx'
import type { Citation } from './types.ts'

function toWhatsApp(md: string): string {
  return md
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1: $2')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
}

function toPlain(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)')
    .replace(/^[ \t]*[-*•][ \t]+/gm, '- ')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

export function formatForChannel(text: string, citations: Citation[], channel: 'sms' | 'whatsapp', disclaimer?: string | null): string {
  const body = text.replace(/\s*\[\d+\]/g, '').trim()
  const sources = citations.slice(0, 3).map(citationLabel)
  if (channel === 'whatsapp') {
    const parts = [toWhatsApp(body)]
    if (sources.length) parts.push(`_Sources: ${sources.join('; ')}_`)
    if (disclaimer) parts.push(`_${disclaimer}_`)
    return truncate(parts.join('\n\n'), 4000)
  }
  const parts = [toPlain(body)]
  if (sources.length) parts.push(`Sources: ${sources.join('; ')}`)
  if (disclaimer) parts.push(disclaimer)
  return truncate(parts.join('\n\n'), 1200)
}

/** GSM-7 messages are 160 chars (153 when split); anything else is UCS-2 at 70 (67). */
export function smsSegments(text: string): number {
  const gsm = /^[\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/.test(text)
  const single = gsm ? 160 : 70
  const multi = gsm ? 153 : 67
  return text.length <= single ? 1 : Math.ceil(text.length / multi)
}
