/** Emails via Resend: hand-off alerts and workspace invites. */
import type { Db } from './db.ts'
import { env } from './env.ts'

export async function sendEmail(to: string | string[], subject: string, html: string): Promise<boolean> {
  const key = env('RESEND_API_KEY')
  const from = env('EMAIL_FROM')
  if (!key || !from) {
    console.warn('email skipped: RESEND_API_KEY / EMAIL_FROM not set')
    return false
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  })
  if (!res.ok) {
    const text = await res.text()
    // 4xx won't fix itself; let 5xx retry.
    if (res.status >= 500) throw new Error(`Resend ${res.status}: ${text.slice(0, 200)}`)
    console.error('Resend refused email', res.status, text.slice(0, 200))
    return false
  }
  return true
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Tells the team a conversation needs a person (job: notify_handoff). */
export async function notifyHandoff(db: Db, conversationId: string): Promise<void> {
  const { data: c } = await db
    .from('conversations')
    .select('id, workspace_id, channel, title, assigned_to, bots(name, handoff), contacts(name, external_id, email, phone), workspaces(name, settings)')
    .eq('id', conversationId)
    .maybeSingle()
  if (!c) return
  const conv = c as any
  if (conv.assigned_to) return // someone already took it

  const to = conv.bots?.handoff?.email || conv.workspaces?.settings?.notify_email
  if (!to) return
  const { data: last } = await db.from('messages').select('role, content').eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).limit(6)
  const transcript = (last ?? []).reverse()
    .map((m) => `<p><b>${m.role === 'user' ? 'Customer' : m.role === 'agent' ? 'Team' : 'Bot'}:</b> ${escapeHtml(m.content).slice(0, 800)}</p>`)
    .join('')
  const who = conv.contacts?.name || conv.contacts?.email || conv.contacts?.phone || conv.contacts?.external_id || 'A visitor'
  const link = env('DASHBOARD_URL') ? `${env('DASHBOARD_URL')}/inbox?c=${conv.id}` : null
  await sendEmail(
    to,
    `${conv.bots?.name ?? 'Your bot'}: ${who} wants to talk to a person`,
    `<p>${escapeHtml(who)} asked for a person on ${escapeHtml(conv.channel)}.</p>${transcript}${
      link ? `<p><a href="${link}">Reply in BotDesk</a></p>` : ''
    }`,
  )
}
