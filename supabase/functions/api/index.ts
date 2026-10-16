/**
 * BotDesk public API — /functions/v1/api/v1/...
 *
 * Two kinds of caller:
 *  - The web widget: a publishable key (bd_pk_...) plus a widget session
 *    from POST /v1/widget/session. Checked against the bot's allowed domains.
 *  - Servers and mobile backends (e.g. LegAI): a secret key (bd_sk_...) in
 *    `Authorization: Bearer`. Never from a browser.
 *
 * Endpoints are documented in docs/API.md.
 */
import { type KeyPrincipal, keyFromRequest, requireKey, verifyApiKey } from '../_shared/auth/keys.ts'
import { type Session, signSession, verifySession } from '../_shared/auth/session.ts'
import { isOriginAllowed } from '../_shared/cors.ts'
import {
  type BotContext,
  conversationFor,
  loadBotContext,
  loadHistory,
  resolveBotId,
  saveMessage,
  setConversation,
  upsertContact,
} from '../_shared/conversations.ts'
import { type Db, must, serviceDb } from '../_shared/db.ts'
import {
  badRequest,
  corsHeaders,
  errorResponse,
  forbidden,
  HttpError,
  json,
  notFound,
  readJson,
  Router,
  sseResponse,
  tooMany,
} from '../_shared/http.ts'
import { analyzeSegment, type Segment, summarizeSession } from '../_shared/legal/analyze.ts'
import { answer, type AnswerResult, legalMode } from '../_shared/rag/answer.ts'
import { maybeQueueReview } from '../_shared/rag/review.ts'
import { retrieve } from '../_shared/rag/retrieve.ts'
import type { Channel } from '../_shared/types.ts'
import { assertMessageQuota } from '../_shared/usage.ts'

const router = new Router()

// ── Helpers ───────────────────────────────────────────────────────────────

interface Caller {
  key: KeyPrincipal
  /** Present for widget calls. */
  session: Session | null
  channel: Channel
  origin: string | null
}

/** Widget (publishable key + session) or server (secret key). */
async function caller(db: Db, req: Request, body: Record<string, unknown>, scope: 'chat' | 'conversations' = 'chat'): Promise<Caller> {
  const key = await verifyApiKey(db, keyFromRequest(req, body.api_key))
  if (!key) throw new HttpError(401, 'unauthorized', 'Missing or invalid API key.')
  const origin = req.headers.get('origin')
  if (key.kind === 'secret') {
    if (origin) throw forbidden('Secret keys must not be used from a browser. Use a publishable key with the widget.')
    if (!key.scopes.includes(scope)) throw forbidden(`This key does not have the "${scope}" scope.`)
    return { key, session: null, channel: 'api', origin }
  }
  const session = await verifySession(req.headers.get('x-session') ?? (body.session as string | undefined))
  if (!session || session.ws !== key.workspaceId || (key.botId && key.botId !== session.bot)) {
    throw new HttpError(401, 'session_expired', 'Your chat session has expired. Please reload the page.')
  }
  return { key, session, channel: 'web', origin }
}

function checkOrigin(ctx: BotContext, origin: string | null) {
  if (!isOriginAllowed(origin, ctx.bot.allowed_domains)) {
    throw forbidden('This website is not allowed to use this bot. Add it under the bot\'s allowed domains.')
  }
}

async function rateLimit(db: Db, key: string, limit: number) {
  const { data } = await db.rpc('hit_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: 60 })
  if (data === false) throw tooMany()
}

function answerJson(r: AnswerResult) {
  return {
    text: r.text,
    outcome: r.outcome,
    citations: r.citations,
    confidence: r.confidence,
    offer_handoff: r.offerHandoff,
    disclaimer: r.disclaimer,
    jurisdiction: r.jurisdiction,
    legal: r.legal,
  }
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

// ── Widget session ────────────────────────────────────────────────────────

router.on('POST', '/v1/widget/session', async (req) => {
  const db = serviceDb()
  const body = await readJson(req)
  const key = await verifyApiKey(db, keyFromRequest(req, body.api_key))
  if (!key || key.kind !== 'publishable') throw new HttpError(401, 'unauthorized', 'Use a publishable key (bd_pk_...).')
  const botId = await resolveBotId(db, key.workspaceId, key.botId, body.bot_id)
  const ctx = await loadBotContext(db, botId)
  checkOrigin(ctx, req.headers.get('origin'))
  if (ctx.bot.status !== 'live') throw new HttpError(503, 'unavailable', 'This assistant is not available right now.')

  const visitor = str(body.visitor_id, 100)
  if (!visitor || !/^[A-Za-z0-9_-]{8,100}$/.test(visitor)) throw badRequest('visitor_id must be 8-100 letters, digits, - or _.')
  await rateLimit(db, `session:${botId}:${visitor}`, 20)

  const contact = await upsertContact(db, key.workspaceId, 'web', visitor, {
    metadata: { page: str(body.page_url, 500), language: str(body.language, 20) },
  })
  const token = await signSession({ ws: key.workspaceId, bot: botId, ct: contact.id })

  // Resume the visitor's latest open conversation.
  const { data: conv } = await db.from('conversations').select('id, status')
    .eq('bot_id', botId).eq('contact_id', contact.id).neq('status', 'resolved')
    .gte('last_message_at', new Date(Date.now() - 7 * 86400_000).toISOString())
    .order('last_message_at', { ascending: false }).limit(1).maybeSingle()
  const messages = conv
    ? ((await must(db.from('messages').select('id, role, content, citations, created_at')
      .eq('conversation_id', conv.id).in('role', ['user', 'assistant', 'agent'])
      .order('created_at', { ascending: false }).limit(30))) as any[]).reverse()
    : []

  const w = ctx.bot.widget ?? {}
  return json({
    session: token,
    bot: {
      id: ctx.bot.id,
      name: ctx.bot.name,
      title: w.title ?? ctx.bot.name,
      subtitle: w.subtitle ?? null,
      welcome_message: w.welcome_message ?? 'Hi! How can I help you today?',
      primary_color: w.primary_color ?? '#6d5df5',
      position: w.position ?? 'bottom-right',
      launcher_label: w.launcher_label ?? null,
      suggested_questions: (w.suggested_questions ?? []).slice(0, 4),
      show_sources: w.show_sources !== false,
      avatar_url: w.avatar_url ?? null,
      handoff: ctx.bot.handoff?.enabled !== false,
      disclaimer: legalMode(ctx) ? (ctx.bot.legal?.disclaimer ?? null) : null,
    },
    conversation: conv ? { id: conv.id, status: conv.status, messages } : null,
  }, 200, corsHeaders(req.headers.get('origin')))
})

// ── Chat ──────────────────────────────────────────────────────────────────

router.on('POST', '/v1/chat', async (req) => {
  const db = serviceDb()
  const body = await readJson(req, 64_000)
  const who = await caller(db, req, body)
  const message = str(body.message, 4000)
  if (!message) throw badRequest('"message" is required (up to 4,000 characters).')

  // Who is talking, and to which bot.
  let botId: string
  let contactId: string
  if (who.session) {
    botId = who.session.bot
    contactId = who.session.ct
  } else {
    botId = await resolveBotId(db, who.key.workspaceId, who.key.botId, body.bot_id)
    const user = (body.user ?? {}) as Record<string, unknown>
    const externalId = str(user.id, 200)
    if (!externalId) throw badRequest('"user.id" is required with a secret key: your own id for the person asking.')
    const contact = await upsertContact(db, who.key.workspaceId, 'api', externalId, {
      name: str(user.name, 120), email: str(user.email, 200), phone: str(user.phone, 40),
      metadata: (user.metadata && typeof user.metadata === 'object') ? user.metadata as Record<string, unknown> : undefined,
    })
    contactId = contact.id
  }

  const ctx = await loadBotContext(db, botId)
  if (who.channel === 'web') checkOrigin(ctx, who.origin)
  if (ctx.bot.status === 'paused') throw new HttpError(503, 'unavailable', 'This assistant is paused.')
  await rateLimit(db, `chat:${botId}:${contactId}`, ctx.bot.rate_limit_per_min)
  if (who.key.kind === 'secret') await rateLimit(db, `key:${who.key.keyId}`, 600)

  const jurisdiction = str(body.jurisdiction, 12)?.toUpperCase() ?? null
  const conv = await conversationFor(db, {
    workspaceId: who.key.workspaceId,
    botId,
    contactId,
    channel: who.channel,
    conversationId: str(body.conversation_id, 40),
    externalRef: str(body.conversation_ref, 120),
    jurisdiction,
    forceNew: body.new_conversation === true,
    reuseHours: who.channel === 'web' ? 24 * 7 : 24,
  })
  if (jurisdiction && conv.jurisdiction !== jurisdiction) await setConversation(db, conv.id, { jurisdiction })

  const history = await loadHistory(db, conv.id, ctx.bot.answer_policy?.history_turns ?? 6)
  const userMsg = await saveMessage(db, {
    workspace_id: who.key.workspaceId,
    conversation_id: conv.id,
    role: 'user',
    content: message,
    channel_message_id: str(body.client_message_id, 100),
  })
  if (!userMsg) throw new HttpError(409, 'duplicate', 'This message was already received.')

  // A person is handling this conversation: no bot reply.
  if (conv.status === 'handoff') {
    return json({ conversation_id: conv.id, message_id: userMsg.id, handoff: true, answer: null }, 200, corsHeaders(who.origin))
  }
  await assertMessageQuota(db, who.key.workspaceId)

  const format = body.format === 'legal' ? 'legal' : body.format === 'text' ? 'text' : undefined
  const run = async (onDelta?: (t: string) => void) => {
    const result = await answer({
      db, ctx, conversation: { id: conv.id, jurisdiction: jurisdiction ?? conv.jurisdiction },
      question: message, history, channel: who.channel, format, jurisdiction, onDelta,
    })
    const saved = await saveMessage(db, {
      workspace_id: who.key.workspaceId,
      conversation_id: conv.id,
      role: 'assistant',
      content: result.text,
      citations: result.citations,
      structured: result.legal,
      outcome: result.outcome,
      confidence: result.confidence,
      model: result.model,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      latency_ms: result.latencyMs,
    })
    if (saved) await maybeQueueReview(db, ctx, { conversationId: conv.id, messageId: saved.id, question: message, result })
    return { result, messageId: saved?.id ?? null }
  }

  if (body.stream === true) {
    return sseResponse(async (w) => {
      w.send('start', { conversation_id: conv.id, user_message_id: userMsg.id })
      const { result, messageId } = await run((t) => w.send('delta', { text: t }))
      w.send('done', { conversation_id: conv.id, message_id: messageId, answer: answerJson(result) })
    }, corsHeaders(who.origin))
  }
  const { result, messageId } = await run()
  return json({
    conversation_id: conv.id,
    message_id: messageId,
    handoff: false,
    answer: answerJson(result),
  }, 200, corsHeaders(who.origin))
})

// ── Hand-off to a person ──────────────────────────────────────────────────

router.on('POST', '/v1/handoff', async (req) => {
  const db = serviceDb()
  const body = await readJson(req)
  const who = await caller(db, req, body)
  const convId = str(body.conversation_id, 40)
  if (!convId) throw badRequest('"conversation_id" is required.')
  const conv = await ownConversation(db, who, convId)
  const ctx = await loadBotContext(db, conv.bot_id)
  if (who.channel === 'web') checkOrigin(ctx, who.origin)
  if (ctx.bot.handoff?.enabled === false) throw forbidden('This assistant does not hand over to people.')

  await upsertContactInfo(db, conv.contact_id, body)
  const note = str(body.note, 1000)
  await saveMessage(db, {
    workspace_id: conv.workspace_id, conversation_id: conv.id, role: 'system',
    content: `Asked to talk to a person.${note ? ` Note: ${note}` : ''}`,
  })
  await setConversation(db, conv.id, { status: 'handoff' })
  const msg = ctx.bot.handoff?.message?.trim() || "Thanks! Someone from our team will reply here as soon as they can."
  return json({ ok: true, message: msg }, 200, corsHeaders(who.origin))
})

async function upsertContactInfo(db: Db, contactId: string, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}
  const name = str(body.name, 120)
  const email = str(body.email, 200)
  const phone = str(body.phone, 40)
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('That email address does not look right.')
  if (name) patch.name = name
  if (email) patch.email = email
  if (phone) patch.phone = phone
  if (Object.keys(patch).length) await must(db.from('contacts').update(patch).eq('id', contactId))
}

async function ownConversation(db: Db, who: Caller, convId: string) {
  const { data } = await db.from('conversations')
    .select('id, workspace_id, bot_id, contact_id, status')
    .eq('id', convId).eq('workspace_id', who.key.workspaceId).maybeSingle()
  if (!data) throw notFound('Conversation not found.')
  if (who.session && (data.contact_id !== who.session.ct || data.bot_id !== who.session.bot)) throw notFound('Conversation not found.')
  if (!who.session && who.key.botId && data.bot_id !== who.key.botId) throw notFound('Conversation not found.')
  return data
}

// ── Messages (polling for replies from people) ────────────────────────────

router.on('GET', '/v1/conversations/:id/messages', async (req, params, url) => {
  const db = serviceDb()
  const who = await caller(db, req, { session: url.searchParams.get('session') }, 'conversations')
  const conv = await ownConversation(db, who, params.id)
  let q = db.from('messages').select('id, role, content, citations, structured, outcome, created_at')
    .eq('conversation_id', conv.id).in('role', ['user', 'assistant', 'agent'])
    .order('created_at', { ascending: true }).limit(100)
  const after = url.searchParams.get('after')
  if (after && !Number.isNaN(Date.parse(after))) q = q.gt('created_at', after)
  return json({ conversation: { id: conv.id, status: conv.status }, messages: await must(q) }, 200, corsHeaders(who.origin))
})

// ── Feedback ──────────────────────────────────────────────────────────────

router.on('POST', '/v1/feedback', async (req) => {
  const db = serviceDb()
  const body = await readJson(req)
  const who = await caller(db, req, body)
  const messageId = str(body.message_id, 40)
  const rating = Number(body.rating)
  if (!messageId || (rating !== 1 && rating !== -1)) throw badRequest('Send "message_id" and "rating" (1 or -1).')
  const { data: m } = await db.from('messages').select('id, conversation_id, role').eq('id', messageId)
    .eq('workspace_id', who.key.workspaceId).maybeSingle()
  if (!m || m.role !== 'assistant') throw notFound('Message not found.')
  await ownConversation(db, who, m.conversation_id)
  await must(db.from('feedback').upsert({
    workspace_id: who.key.workspaceId, message_id: m.id, rating, comment: str(body.comment, 1000),
    origin: who.session ? 'visitor' : 'api',
  }, { onConflict: 'message_id,origin' }))
  return json({ ok: true }, 200, corsHeaders(who.origin))
})

// ── Search (retrieval only) ───────────────────────────────────────────────

router.on('POST', '/v1/search', async (req) => {
  const db = serviceDb()
  const key = await requireKey(db, req, { scope: 'chat', kind: 'secret' })
  const body = await readJson(req)
  const query = str(body.query, 2000)
  if (!query) throw badRequest('"query" is required.')
  const botId = await resolveBotId(db, key.workspaceId, key.botId, body.bot_id)
  const ctx = await loadBotContext(db, botId)
  await rateLimit(db, `key:${key.keyId}`, 600)
  const { kept } = await retrieve(db, key.workspaceId, ctx.kbs, query, {
    topK: Math.min(Number(body.top_k ?? 8), 20),
    minScore: Number(body.min_score ?? ctx.bot.answer_policy?.min_score ?? 0.3),
    jurisdiction: str(body.jurisdiction, 12)?.toUpperCase() ?? null,
    botId,
  })
  return json({ results: kept })
})

// ── Knowledge: feed sources programmatically ──────────────────────────────

const SOURCE_FIELDS = 'id, knowledge_base_id, kind, title, url, status, error, chunk_count, token_count, jurisdiction, source_type, citation, effective_date, superseded, metadata, created_at, updated_at, last_indexed_at'

router.on('GET', '/v1/knowledge-bases', async (req) => {
  const db = serviceDb()
  const key = await requireKey(db, req, { scope: 'ingest', kind: 'secret' })
  return json({
    knowledge_bases: await must(db.from('knowledge_bases').select('id, name, description, embedding_model, legal, created_at')
      .eq('workspace_id', key.workspaceId).order('created_at')),
  })
})

async function ownKb(db: Db, workspaceId: string, kbId: unknown) {
  if (typeof kbId !== 'string') throw badRequest('"knowledge_base_id" is required.')
  const { data } = await db.from('knowledge_bases').select('id').eq('id', kbId).eq('workspace_id', workspaceId).maybeSingle()
  if (!data) throw notFound('Knowledge base not found.')
  return data.id as string
}

function legalFields(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  const j = str(body.jurisdiction, 12)
  if (j) out.jurisdiction = j.toUpperCase()
  if (body.source_type) out.source_type = str(body.source_type, 30)
  if (body.citation) out.citation = str(body.citation, 300)
  if (body.effective_date && !Number.isNaN(Date.parse(String(body.effective_date)))) out.effective_date = String(body.effective_date).slice(0, 10)
  if (typeof body.superseded === 'boolean') out.superseded = body.superseded
  if (body.metadata && typeof body.metadata === 'object') out.metadata = body.metadata
  if (typeof body.refresh_hours === 'number') out.refresh_hours = Math.max(1, Math.round(body.refresh_hours))
  return out
}

router.on('POST', '/v1/sources', async (req) => {
  const db = serviceDb()
  const key = await requireKey(db, req, { scope: 'ingest', kind: 'secret' })
  const body = await readJson(req, 2_000_000)
  const kbId = await ownKb(db, key.workspaceId, body.knowledge_base_id)
  const kind = String(body.kind ?? 'text')
  const row: Record<string, unknown> = {
    workspace_id: key.workspaceId, knowledge_base_id: kbId, kind, title: str(body.title, 200) ?? '', ...legalFields(body),
  }
  if (kind === 'text') {
    row.content = str(body.content, 1_500_000)
    if (!row.content) throw badRequest('"content" is required for text sources.')
  } else if (kind === 'qa') {
    row.question = str(body.question, 2000)
    row.content = str(body.answer ?? body.content, 20_000)
    if (!row.question || !row.content) throw badRequest('"question" and "answer" are required for Q&A sources.')
    row.title = row.title || String(row.question).slice(0, 200)
  } else if (kind === 'url' || kind === 'sitemap') {
    row.url = str(body.url, 2000)
    if (!row.url || !/^https?:\/\//i.test(String(row.url))) throw badRequest('"url" must be an http(s) link.')
    if (kind === 'sitemap' && body.max_pages) row.metadata = { ...(row.metadata as object ?? {}), max_pages: Number(body.max_pages) }
  } else {
    throw badRequest('"kind" must be text, qa, url or sitemap. Upload files with POST /v1/sources/upload.')
  }

  // Upsert by external_id lets a content system keep one source per document.
  const externalId = str(body.external_id, 200)
  if (externalId) {
    row.metadata = { ...(row.metadata as object ?? {}), external_id: externalId }
    const { data: existing } = await db.from('sources').select('id').eq('knowledge_base_id', kbId)
      .eq('metadata->>external_id', externalId).maybeSingle()
    if (existing) {
      const updated = await must(db.from('sources').update({ ...row, status: 'queued', checksum: null })
        .eq('id', existing.id).select(SOURCE_FIELDS).single())
      return json({ source: updated, updated: true })
    }
  }
  const created = await must(db.from('sources').insert(row).select(SOURCE_FIELDS).single())
  return json({ source: created }, 201)
})

const UPLOAD_TYPES = /\.(pdf|docx|txt|md|markdown|csv|html?|json)$/i

router.on('POST', '/v1/sources/upload', async (req) => {
  const db = serviceDb()
  const key = await requireKey(db, req, { scope: 'ingest', kind: 'secret' })
  if (Number(req.headers.get('content-length') ?? 0) > 50 * 1024 * 1024) throw new HttpError(413, 'too_large', 'Files can be up to 50 MB.')
  const form = await req.formData().catch(() => null)
  if (!form) throw badRequest('Send multipart/form-data with a "file" field.')
  const file = form.get('file')
  if (!(file instanceof File)) throw badRequest('"file" is required.')
  if (!UPLOAD_TYPES.test(file.name)) throw badRequest('Upload PDF, Word (.docx), text, Markdown, CSV, HTML or JSON.')
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, unknown>
  if (typeof fields.metadata === 'string') {
    try {
      fields.metadata = JSON.parse(fields.metadata as string)
    } catch {
      throw badRequest('"metadata" must be JSON.')
    }
  }
  if (fields.superseded === 'true') fields.superseded = true
  const kbId = await ownKb(db, key.workspaceId, fields.knowledge_base_id)

  const id = crypto.randomUUID()
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-120) || 'file'
  const path = `${key.workspaceId}/${id}/${safeName}`
  const { error } = await db.storage.from('sources').upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (error) throw new HttpError(500, 'upload_failed', `Could not store the file: ${error.message}`)
  const created = await must(db.from('sources').insert({
    id, workspace_id: key.workspaceId, knowledge_base_id: kbId, kind: 'file',
    title: str(fields.title, 200) ?? file.name.replace(/\.[^.]+$/, ''),
    storage_path: path, mime_type: file.type || null, bytes: file.size, ...legalFields(fields),
  }).select(SOURCE_FIELDS).single())
  return json({ source: created }, 201)
})

router.on('GET', '/v1/sources/:id', async (req, params) => {
  const db = serviceDb()
  const key = await requireKey(db, req, { scope: 'ingest', kind: 'secret' })
  const s = await must(db.from('sources').select(`${SOURCE_FIELDS}, progress`).eq('id', params.id)
    .eq('workspace_id', key.workspaceId).maybeSingle())
  if (!s) throw notFound('Source not found.')
  return json({ source: s })
})

router.on('DELETE', '/v1/sources/:id', async (req, params) => {
  const db = serviceDb()
  const key = await requireKey(db, req, { scope: 'ingest', kind: 'secret' })
  const { data } = await db.from('sources').delete().eq('id', params.id).eq('workspace_id', key.workspaceId).select('id')
  if (!data?.length) throw notFound('Source not found.')
  return json({ ok: true })
})

// ── Legal pack: Listen In analysis ────────────────────────────────────────

async function legalBot(db: Db, key: KeyPrincipal, requested: unknown) {
  const botId = await resolveBotId(db, key.workspaceId, key.botId, requested)
  const ctx = await loadBotContext(db, botId)
  if (ctx.workspace.features?.legal !== true) throw forbidden('The legal pack is not enabled for this workspace.')
  await rateLimit(db, `key:${key.keyId}`, 600)
  return ctx
}

function parseSegment(v: unknown, i = 0): Segment {
  const s = (v ?? {}) as Record<string, unknown>
  const text = str(s.text, 4000)
  if (!text) throw badRequest('Each segment needs "text".')
  return {
    id: str(s.id, 80) ?? `seg-${i}`,
    text,
    start_ms: typeof s.start_ms === 'number' ? Math.max(0, Math.round(s.start_ms)) : 0,
    speaker: str(s.speaker, 60),
  }
}

router.on('POST', '/v1/legal/analyze', async (req) => {
  const db = serviceDb()
  const key = await requireKey(db, req, { scope: 'analyze', kind: 'secret' })
  const body = await readJson(req, 128_000)
  const ctx = await legalBot(db, key, body.bot_id)
  await assertMessageQuota(db, key.workspaceId)
  const c = (body.context ?? {}) as Record<string, unknown>
  const { flags, model } = await analyzeSegment(db, ctx, parseSegment(body.segment), {
    topic: str(c.topic, 80),
    jurisdiction: str(c.jurisdiction, 12)?.toUpperCase() ?? null,
    already_flagged: Array.isArray(c.already_flagged) ? c.already_flagged.map(String).slice(0, 100) : [],
    previous: Array.isArray(c.previous) ? c.previous.slice(-4).map(parseSegment) : [],
  })
  return json({ flags, model })
})

router.on('POST', '/v1/legal/summarize', async (req) => {
  const db = serviceDb()
  const key = await requireKey(db, req, { scope: 'analyze', kind: 'secret' })
  const body = await readJson(req, 512_000)
  const ctx = await legalBot(db, key, body.bot_id)
  if (!Array.isArray(body.segments) || !body.segments.length) throw badRequest('"segments" is required.')
  const summary = await summarizeSession(db, ctx, {
    segments: body.segments.slice(0, 2000).map(parseSegment),
    flags: Array.isArray(body.flags) ? body.flags.slice(0, 50).map((f: any) => ({ title: String(f?.title ?? '') })) : [],
    topic: str(body.topic, 80),
  })
  return json({ summary })
})

// ── Privacy: erase a person's data ────────────────────────────────────────

router.on('DELETE', '/v1/contacts/:externalId', async (req, params, url) => {
  const db = serviceDb()
  const key = await requireKey(db, req, { scope: 'conversations', kind: 'secret' })
  const channel = url.searchParams.get('channel') ?? 'api'
  if (!['web', 'api', 'whatsapp', 'sms'].includes(channel)) throw badRequest('Unknown channel.')
  const { data } = await db.from('contacts').delete().eq('workspace_id', key.workspaceId).eq('channel', channel)
    .eq('external_id', params.externalId).select('id')
  return json({ deleted: data?.length ?? 0 })
})

router.on('GET', '/v1/health', () => json({ ok: true, service: 'botdesk-api', version: 2 }))

// ── Server ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  try {
    const match = router.match(req.method, Router.localPath(url, 'api'))
    if (match === 'method') return json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405, corsHeaders(origin))
    if (!match) return json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404, corsHeaders(origin))
    return await match.handler(req, match.params, url)
  } catch (err) {
    return errorResponse(err, corsHeaders(origin))
  }
})
