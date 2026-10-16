/** Bots, contacts, conversations and messages, as the functions use them. */
import type { ChatMessage } from './ai/types.ts'
import { type Db, DbError, must } from './db.ts'
import { HttpError, notFound } from './http.ts'
import type { BotRow, Channel, ConversationRow, KnowledgeBaseRow, WorkspaceRow } from './types.ts'

export interface BotContext {
  bot: BotRow
  workspace: WorkspaceRow
  kbs: KnowledgeBaseRow[]
}

const botCache = new Map<string, { at: number; ctx: BotContext }>()

export async function loadBotContext(db: Db, botId: string, opts: { fresh?: boolean } = {}): Promise<BotContext> {
  const hit = botCache.get(botId)
  if (!opts.fresh && hit && Date.now() - hit.at < 20_000) return hit.ctx

  const bot = await must(db.from('bots').select('*').eq('id', botId).maybeSingle()) as BotRow | null
  if (!bot) throw notFound('Bot not found.')
  const [workspace, links] = await Promise.all([
    must(db.from('workspaces').select('id, name, slug, plan, features, settings').eq('id', bot.workspace_id).single()),
    must(
      db.from('bot_knowledge_bases')
        .select('knowledge_bases(id, workspace_id, name, embedding_provider, embedding_model, chunk_tokens, chunk_overlap, legal)')
        .eq('bot_id', botId),
    ),
  ])
  const kbs = ((links ?? []) as any[]).map((l) => l.knowledge_bases).filter(Boolean) as KnowledgeBaseRow[]
  const ctx = { bot, workspace: workspace as unknown as WorkspaceRow, kbs }
  botCache.set(botId, { at: Date.now(), ctx })
  return ctx
}

/** The bot a key may use: the key's own bot, or the one named in the request. */
export async function resolveBotId(
  db: Db,
  workspaceId: string,
  keyBotId: string | null,
  requested: unknown,
): Promise<string> {
  if (keyBotId) {
    if (requested && requested !== keyBotId) throw new HttpError(403, 'forbidden', 'This key belongs to a different bot.')
    return keyBotId
  }
  if (typeof requested === 'string' && requested) {
    const { data } = await db.from('bots').select('id').eq('id', requested).eq('workspace_id', workspaceId).maybeSingle()
    if (!data) throw notFound('Bot not found in this workspace.')
    return data.id
  }
  const { data } = await db.from('bots').select('id').eq('workspace_id', workspaceId).order('created_at').limit(2)
  if (data?.length === 1) return data[0].id
  throw new HttpError(400, 'bad_request', 'Say which bot to use: pass "bot_id".')
}

export async function upsertContact(
  db: Db,
  workspaceId: string,
  channel: Channel,
  externalId: string,
  info: { name?: string | null; email?: string | null; phone?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<{ id: string; name: string | null }> {
  const row: Record<string, unknown> = {
    workspace_id: workspaceId,
    channel,
    external_id: externalId.slice(0, 200),
    last_seen_at: new Date().toISOString(),
  }
  if (info.name) row.name = info.name.slice(0, 120)
  if (info.email) row.email = info.email.slice(0, 200)
  if (info.phone) row.phone = info.phone.slice(0, 40)
  if (info.metadata) row.metadata = info.metadata
  return await must(
    db.from('contacts').upsert(row, { onConflict: 'workspace_id,channel,external_id' }).select('id, name').single(),
  )
}

/**
 * The conversation a new message belongs to: the one named (if it is this
 * contact's), otherwise the contact's latest unresolved conversation with
 * this bot when it was active in the last `reuseHours`, otherwise a new one.
 */
export async function conversationFor(
  db: Db,
  opts: {
    workspaceId: string
    botId: string
    contactId: string
    channel: Channel
    conversationId?: string | null
    /** The caller's own id for the conversation (e.g. an app's local thread id). */
    externalRef?: string | null
    botChannelId?: string | null
    jurisdiction?: string | null
    reuseHours?: number
    forceNew?: boolean
  },
): Promise<ConversationRow> {
  const cols = 'id, workspace_id, bot_id, contact_id, channel, status, bot_channel_id, jurisdiction, metadata'
  if (opts.conversationId) {
    const { data } = await db
      .from('conversations')
      .select(cols)
      .eq('id', opts.conversationId)
      .eq('contact_id', opts.contactId)
      .eq('bot_id', opts.botId)
      .maybeSingle()
    if (!data) throw notFound('Conversation not found.')
    return data as ConversationRow
  }
  if (opts.externalRef) {
    // One BotDesk conversation per caller reference, whatever its age.
    const found = await byRef(db, cols, opts.botId, opts.contactId, opts.externalRef)
    if (found) return await reopened(db, found, cols)
  } else if (!opts.forceNew) {
    const since = new Date(Date.now() - (opts.reuseHours ?? 24) * 3600_000).toISOString()
    const { data } = await db
      .from('conversations')
      .select(cols)
      .eq('bot_id', opts.botId)
      .eq('contact_id', opts.contactId)
      .neq('status', 'resolved')
      .gte('last_message_at', since)
      .order('last_message_at', { ascending: false })
      .limit(1)
    if (data?.[0]) return data[0] as ConversationRow
  }
  const { data, error } = await db.from('conversations').insert({
    workspace_id: opts.workspaceId,
    bot_id: opts.botId,
    contact_id: opts.contactId,
    channel: opts.channel,
    bot_channel_id: opts.botChannelId ?? null,
    jurisdiction: opts.jurisdiction ?? null,
    metadata: opts.externalRef ? { ref: opts.externalRef } : {},
  }).select(cols).single()
  if (error?.code === '23505' && opts.externalRef) {
    // Two first messages for the same reference raced; use the one that won.
    const found = await byRef(db, cols, opts.botId, opts.contactId, opts.externalRef)
    if (found) return found
  }
  if (error) throw new DbError(error.message, error.code)
  return data as ConversationRow
}

async function byRef(db: Db, cols: string, botId: string, contactId: string, ref: string): Promise<ConversationRow | null> {
  const { data } = await db.from('conversations').select(cols)
    .eq('bot_id', botId).eq('contact_id', contactId).eq('metadata->>ref', ref).limit(1)
  return (data?.[0] as ConversationRow | undefined) ?? null
}

/** A new message in a resolved conversation opens it again. */
async function reopened(db: Db, conv: ConversationRow, cols: string): Promise<ConversationRow> {
  if (conv.status !== 'resolved') return conv
  const { data } = await db.from('conversations').update({ status: 'open' }).eq('id', conv.id).select(cols).single()
  return (data as ConversationRow | null) ?? { ...conv, status: 'open' }
}

/** Recent turns as chat messages (people's replies count as the assistant). */
export async function loadHistory(db: Db, conversationId: string, turns: number): Promise<ChatMessage[]> {
  if (turns <= 0) return []
  const { data } = await db
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant', 'agent'])
    .order('created_at', { ascending: false })
    .limit(turns * 2)
  const rows = (data ?? []).reverse()
  const out: ChatMessage[] = []
  for (const r of rows) {
    const role = r.role === 'user' ? 'user' : 'assistant'
    const content = String(r.content).slice(0, 4000)
    // Models need alternating turns; merge repeats.
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n\n${content}`
    else out.push({ role, content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

export interface NewMessage {
  workspace_id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'agent' | 'system'
  content: string
  citations?: unknown[]
  structured?: unknown
  outcome?: 'answered' | 'no_answer' | 'handoff' | 'error' | null
  confidence?: number | null
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  latency_ms?: number | null
  channel_message_id?: string | null
  delivery_status?: 'pending' | 'sent' | 'delivered' | 'failed' | null
}

/** Inserts a message. Returns null if it is a duplicate webhook delivery. */
export async function saveMessage(db: Db, m: NewMessage): Promise<{ id: string; created_at: string } | null> {
  const { data, error } = await db.from('messages').insert(m).select('id, created_at').single()
  if (error) {
    if (error.code === '23505') return null
    throw new HttpError(500, 'internal', `Could not save message: ${error.message}`)
  }
  return data
}

export async function setConversation(db: Db, id: string, patch: Record<string, unknown>) {
  await must(db.from('conversations').update(patch).eq('id', id))
}
