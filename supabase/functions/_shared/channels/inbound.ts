/** WhatsApp and SMS conversations: from webhook to answer to reply. */
import { conversationFor, loadBotContext, loadHistory, saveMessage, setConversation, upsertContact } from '../conversations.ts'
import { type Db, must } from '../db.ts'
import { answer } from '../rag/answer.ts'
import { maybeQueueReview } from '../rag/review.ts'
import { assertMessageQuota } from '../usage.ts'
import { formatForChannel, wantsHuman } from './format.ts'
import {
  type AfricasTalkingConfig,
  type AfricasTalkingSecret,
  africasTalkingSend,
  type Inbound,
  type TwilioConfig,
  type TwilioSecret,
  twilioSend,
  type WhatsAppConfig,
  type WhatsAppSecret,
  whatsappSend,
} from './providers.ts'

export type ChannelKind = 'whatsapp' | 'twilio_sms' | 'africastalking_sms'

export interface ChannelRow {
  id: string
  workspace_id: string
  bot_id: string
  kind: ChannelKind
  status: 'active' | 'disabled'
  config: Record<string, any>
  secret_id: string | null
  webhook_token: string
  verify_token: string
}

export async function loadChannel(db: Db, kind: ChannelKind, token: string): Promise<ChannelRow | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null
  const { data } = await db.from('bot_channels').select('*').eq('kind', kind).eq('webhook_token', token).maybeSingle()
  return (data as ChannelRow) ?? null
}

export async function channelSecret<T>(db: Db, row: ChannelRow): Promise<T> {
  if (!row.secret_id) throw new Error('This channel has no credentials saved.')
  const { data } = await db.rpc('read_secret', { p_id: row.secret_id })
  if (!data) throw new Error('This channel has no credentials saved.')
  return JSON.parse(data as string) as T
}

export const channelOf = (kind: ChannelKind): 'whatsapp' | 'sms' => (kind === 'whatsapp' ? 'whatsapp' : 'sms')

export async function sendViaChannel(db: Db, row: ChannelRow, to: string, text: string): Promise<string> {
  switch (row.kind) {
    case 'whatsapp':
      return whatsappSend(row.config as WhatsAppConfig, await channelSecret<WhatsAppSecret>(db, row), to, text)
    case 'twilio_sms':
      return twilioSend(row.config as TwilioConfig, await channelSecret<TwilioSecret>(db, row), to, text)
    case 'africastalking_sms':
      return africasTalkingSend(row.config as AfricasTalkingConfig, await channelSecret<AfricasTalkingSecret>(db, row), to, text)
  }
}

async function reply(
  db: Db,
  row: ChannelRow,
  conversationId: string,
  to: string,
  text: string,
  extra: Record<string, unknown> = {},
) {
  const saved = await saveMessage(db, {
    workspace_id: row.workspace_id,
    conversation_id: conversationId,
    role: 'assistant',
    content: text,
    delivery_status: 'pending',
    ...extra,
  })
  try {
    const id = await sendViaChannel(db, row, to, text)
    if (saved) await db.from('messages').update({ delivery_status: 'sent', channel_message_id: id || null }).eq('id', saved.id)
  } catch (err) {
    console.error('channel send failed', row.kind, (err as Error).message)
    if (saved) {
      await db.from('messages').update({ delivery_status: 'failed', delivery_error: (err as Error).message.slice(0, 500) })
        .eq('id', saved.id)
    }
  }
  return saved
}

/** Handles one inbound message end to end. Safe to call twice for the same message. */
export async function handleInbound(db: Db, row: ChannelRow, msg: Inbound): Promise<void> {
  if (row.status !== 'active') return
  const ctx = await loadBotContext(db, row.bot_id)
  if (ctx.bot.status === 'paused') return
  const channel = channelOf(row.kind)

  const contact = await upsertContact(db, row.workspace_id, channel, msg.from, { name: msg.name, phone: msg.from })
  const { data: allowed } = await db.rpc('hit_rate_limit', {
    p_key: `chat:${ctx.bot.id}:${contact.id}`,
    p_limit: ctx.bot.rate_limit_per_min,
    p_window_seconds: 60,
  })
  if (allowed === false) return

  const conv = await conversationFor(db, {
    workspaceId: row.workspace_id,
    botId: ctx.bot.id,
    contactId: contact.id,
    channel,
    botChannelId: row.id,
  })
  const history = await loadHistory(db, conv.id, ctx.bot.answer_policy?.history_turns ?? 6)
  const text = msg.unsupported ? `[${msg.unsupported}]` : msg.text.trim().slice(0, 2000)
  const saved = await saveMessage(db, {
    workspace_id: row.workspace_id,
    conversation_id: conv.id,
    role: 'user',
    content: text || '(empty message)',
    channel_message_id: msg.messageId,
  })
  if (!saved) return // duplicate delivery

  if (msg.unsupported) {
    await reply(db, row, conv.id, msg.from, "Sorry, I can only read text messages. Please type your question.")
    return
  }
  if (conv.status === 'handoff') return // a person is handling it; they reply from the inbox

  if (ctx.bot.handoff?.enabled !== false && wantsHuman(text)) {
    await setConversation(db, conv.id, { status: 'handoff' })
    await reply(db, row, conv.id, msg.from,
      ctx.bot.handoff?.message?.trim() || 'Okay. Someone from our team will reply here as soon as they can.')
    return
  }

  try {
    await assertMessageQuota(db, row.workspace_id)
  } catch {
    await reply(db, row, conv.id, msg.from, "Sorry, I can't answer right now. Please try again later.")
    return
  }

  const result = await answer({ db, ctx, conversation: conv, question: text, history, channel, format: 'text' })
  const { count: earlier } = await db.from('messages').select('id', { count: 'exact', head: true })
    .eq('conversation_id', conv.id).eq('role', 'assistant')
  const formatted = formatForChannel(result.text, result.citations, channel, {
    // The legal disclaimer goes with the first answer of a conversation.
    disclaimer: !earlier ? result.disclaimer : null,
  })
  const out = await reply(db, row, conv.id, msg.from, formatted, {
    citations: result.citations,
    outcome: result.outcome,
    confidence: result.confidence,
    model: result.model,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    latency_ms: result.latencyMs,
  })
  if (out) await maybeQueueReview(db, ctx, { conversationId: conv.id, messageId: out.id, question: text, result })
}

/** Sends a person's inbox reply to WhatsApp/SMS (job: deliver_message). */
export async function deliverAgentMessage(db: Db, messageId: string): Promise<void> {
  const m = await must(db.from('messages').select('id, content, conversation_id, delivery_status').eq('id', messageId).maybeSingle())
  if (!m || m.delivery_status === 'sent') return
  const conv = await must(
    db.from('conversations').select('id, bot_channel_id, contacts(external_id)').eq('id', m.conversation_id).single(),
  ) as any
  if (!conv.bot_channel_id) throw new Error('This conversation has no channel to reply on.')
  const row = await must(db.from('bot_channels').select('*').eq('id', conv.bot_channel_id).single()) as ChannelRow
  const formatted = formatForChannel(m.content, [], channelOf(row.kind))
  const id = await sendViaChannel(db, row, conv.contacts.external_id, formatted)
  await must(db.from('messages').update({ delivery_status: 'sent', channel_message_id: id || null, delivery_error: null }).eq('id', m.id))
}
