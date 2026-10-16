/**
 * Dashboard operations that need server-side secrets or the service role —
 * /functions/v1/admin/...  Every call needs the user's Supabase session
 * (Authorization: Bearer <access token>); roles are checked per workspace.
 * Everything else the dashboard does goes straight to the database under RLS.
 */
import { requireRole, requireUser, type Role } from '../_shared/auth/user.ts'
import { CHAT_MODELS, EMBEDDING_MODELS } from '../_shared/ai/catalog.ts'
import { clearCredentialCache, safeModelOverride, TOGETHER_BASE_URL } from '../_shared/ai/registry.ts'
import { sendViaChannel, type ChannelRow } from '../_shared/channels/inbound.ts'
import { WHATSAPP_GRAPH_VERSION } from '../_shared/channels/providers.ts'
import { loadBotContext } from '../_shared/conversations.ts'
import { type Db, must, serviceDb, userDb } from '../_shared/db.ts'
import { env, fakeAi, publicFunctionsUrl } from '../_shared/env.ts'
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
} from '../_shared/http.ts'
import { analyzeSegment } from '../_shared/legal/analyze.ts'
import { escapeHtml, sendEmail } from '../_shared/notify.ts'
import { answer } from '../_shared/rag/answer.ts'
import { retrieve } from '../_shared/rag/retrieve.ts'
import { buildTrainingFile } from '../_shared/training/finetune.ts'
import { assertMessageQuota, recordUsage } from '../_shared/usage.ts'

const router = new Router()
const PROVIDERS = ['anthropic', 'openai', 'voyage', 'together', 'openai_compatible'] as const

async function auth(req: Request, workspaceId: unknown, min: Role) {
  const db = serviceDb()
  const user = await requireUser(db, req)
  if (typeof workspaceId !== 'string' || !/^[0-9a-f-]{36}$/.test(workspaceId)) throw badRequest('"workspace_id" is required.')
  const role = await requireRole(db, user.userId, workspaceId, min)
  return { db, user, role }
}

async function audit(db: Db, workspaceId: string, actorId: string, action: string, targetType: string, targetId: string, metadata = {}) {
  await db.from('audit_log').insert({
    workspace_id: workspaceId, actor_id: actorId, actor_type: 'user', action, target_type: targetType, target_id: targetId, metadata,
  })
}

const hint = (key: string) => (key.length > 8 ? `…${key.slice(-4)}` : '…')

// ── Model provider keys ───────────────────────────────────────────────────

router.on('POST', '/credentials', async (req) => {
  const body = await readJson(req)
  const { db, user } = await auth(req, body.workspace_id, 'admin')
  const provider = String(body.provider ?? '')
  if (!PROVIDERS.includes(provider as any)) throw badRequest('Unknown provider.')
  const apiKey = String(body.api_key ?? '').trim()
  if (apiKey.length < 8 || apiKey.length > 500) throw badRequest('Paste the full API key.')
  const label = String(body.label ?? 'default').trim().slice(0, 60) || 'default'
  const baseUrl = body.base_url ? String(body.base_url).trim() : null
  if (provider === 'openai_compatible' && !/^https:\/\//.test(baseUrl ?? '')) {
    throw badRequest('An OpenAI-compatible endpoint needs an https base URL, e.g. https://api.example.com/v1')
  }

  const { data: existing } = await db.from('provider_credentials').select('id, secret_id')
    .eq('workspace_id', body.workspace_id).eq('provider', provider).eq('label', label).maybeSingle()
  const { data: secretId, error } = await db.rpc('store_secret', {
    p_secret: apiKey, p_name: `provider:${provider}`, p_existing: existing?.secret_id ?? null,
  })
  if (error) throw new HttpError(500, 'vault', `Could not store the key: ${error.message}`)

  const row = {
    workspace_id: body.workspace_id, provider, label, base_url: baseUrl, secret_id: secretId, key_hint: hint(apiKey),
    created_by: user.userId,
  }
  const saved = existing
    ? await must(db.from('provider_credentials').update(row).eq('id', existing.id).select('id, provider, label, base_url, key_hint, created_at').single())
    : await must(db.from('provider_credentials').insert(row).select('id, provider, label, base_url, key_hint, created_at').single())
  clearCredentialCache()
  await audit(db, String(body.workspace_id), user.userId, 'credential.saved', 'provider', provider, { label })
  return json({ credential: saved }, existing ? 200 : 201)
})

router.on('POST', '/credentials/:id/test', async (req, params) => {
  const body = await readJson(req)
  const { db } = await auth(req, body.workspace_id, 'admin')
  const cred = await must(db.from('provider_credentials').select('*').eq('id', params.id).eq('workspace_id', body.workspace_id).maybeSingle())
  if (!cred) throw notFound('Key not found.')
  const { data: key } = await db.rpc('read_secret', { p_id: cred.secret_id })
  const k = String(key ?? '')
  const check = async (url: string, init: RequestInit) => {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    return { ok: res.ok, status: res.status, detail: res.ok ? 'Key works.' : (await res.text()).slice(0, 200) }
  }
  let r: { ok: boolean; status: number; detail: string }
  switch (cred.provider) {
    case 'anthropic':
      r = await check('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } })
      break
    case 'openai':
      r = await check(`${cred.base_url ?? 'https://api.openai.com/v1'}/models`, { headers: { authorization: `Bearer ${k}` } })
      break
    case 'voyage':
      r = await check('https://api.voyageai.com/v1/embeddings', {
        method: 'POST', headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: ['ping'], model: 'voyage-4-lite' }),
      })
      break
    case 'together':
      r = await check(`${cred.base_url ?? TOGETHER_BASE_URL}/models`, { headers: { authorization: `Bearer ${k}` } })
      break
    default:
      r = await check(`${String(cred.base_url).replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${k}` } })
  }
  return json(r)
})

// ── Models available to a workspace ───────────────────────────────────────

router.on('GET', '/models', async (req, _p, url) => {
  const ws = url.searchParams.get('workspace_id')
  const { db } = await auth(req, ws, 'viewer')
  const [creds, custom, workspace] = await Promise.all([
    must(db.from('provider_credentials').select('provider').eq('workspace_id', ws!)),
    must(db.from('custom_models').select('id, provider, model, label, origin, created_at').eq('workspace_id', ws!)),
    must(db.from('workspaces').select('settings, plans(limits)').eq('id', ws!).single()),
  ])
  const own = new Set((creds as any[]).map((c) => c.provider))
  const platformOk = (workspace as any).plans?.limits?.platform_ai !== false && (workspace as any).settings?.allow_platform_ai !== false
  const platform: Record<string, boolean> = {
    anthropic: platformOk && !!env('ANTHROPIC_API_KEY'),
    openai: platformOk && !!env('OPENAI_API_KEY'),
    voyage: platformOk && !!env('VOYAGE_API_KEY'),
    together: false,
    openai_compatible: false,
  }
  const available = (p: string) => fakeAi() || own.has(p) || platform[p]
  return json({
    fake_ai: fakeAi(),
    providers: Object.fromEntries(PROVIDERS.map((p) => [p, { own_key: own.has(p), platform: platform[p], available: available(p) }])),
    chat: CHAT_MODELS.map((m) => ({ ...m, available: available(m.provider) })),
    embedding: EMBEDDING_MODELS.map((m) => ({ ...m, available: available(m.provider) })),
    custom,
  })
})

// ── Channels (WhatsApp, SMS) ──────────────────────────────────────────────

const CHANNEL_SECRETS: Record<string, string[]> = {
  whatsapp: ['access_token', 'app_secret'],
  twilio_sms: ['auth_token'],
  africastalking_sms: ['api_key'],
}
const CHANNEL_CONFIG: Record<string, string[]> = {
  whatsapp: ['phone_number_id'],
  twilio_sms: ['account_sid', 'from_number'],
  africastalking_sms: ['username'],
}
const PATHS: Record<string, string> = { whatsapp: 'whatsapp', twilio_sms: 'twilio', africastalking_sms: 'africastalking' }

function webhookInfo(row: { kind: string; webhook_token: string; verify_token: string }) {
  return {
    webhook_url: `${publicFunctionsUrl()}/channels/${PATHS[row.kind]}/${row.webhook_token}`,
    verify_token: row.kind === 'whatsapp' ? row.verify_token : undefined,
  }
}

function pickSecrets(kind: string, input: unknown, required: boolean) {
  const s = (input ?? {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of CHANNEL_SECRETS[kind]) {
    const v = typeof s[k] === 'string' ? (s[k] as string).trim() : ''
    if (!v && required) throw badRequest(`"${k}" is required.`)
    if (v) out[k] = v
  }
  return out
}

router.on('POST', '/channels', async (req) => {
  const body = await readJson(req)
  const { db, user } = await auth(req, body.workspace_id, 'admin')
  const kind = String(body.kind ?? '')
  if (!CHANNEL_SECRETS[kind]) throw badRequest('Channel must be whatsapp, twilio_sms or africastalking_sms.')
  const bot = await must(db.from('bots').select('id').eq('id', body.bot_id).eq('workspace_id', body.workspace_id).maybeSingle())
  if (!bot) throw notFound('Bot not found.')
  const config = { ...((body.config ?? {}) as Record<string, unknown>) }
  for (const k of CHANNEL_CONFIG[kind]) if (!String(config[k] ?? '').trim()) throw badRequest(`"${k}" is required.`)
  if (kind === 'whatsapp') config.graph_version ||= WHATSAPP_GRAPH_VERSION

  const secrets = pickSecrets(kind, body.secrets, true)
  const { data: secretId, error } = await db.rpc('store_secret', { p_secret: JSON.stringify(secrets), p_name: `channel:${kind}` })
  if (error) throw new HttpError(500, 'vault', error.message)
  const row = await must(db.from('bot_channels').insert({
    workspace_id: body.workspace_id, bot_id: body.bot_id, kind, name: String(body.name ?? '').slice(0, 80), config, secret_id: secretId,
  }).select('id, kind, name, status, config, webhook_token, verify_token, created_at').single())
  await audit(db, String(body.workspace_id), user.userId, 'channel.created', 'channel', row.id, { kind })
  const { webhook_token: _t, verify_token: _v, ...rest } = row
  return json({ channel: { ...rest, ...webhookInfo(row) } }, 201)
})

router.on('GET', '/channels', async (req, _p, url) => {
  const ws = url.searchParams.get('workspace_id')
  const { db } = await auth(req, ws, 'editor')
  let q = db.from('bot_channels').select('id, bot_id, kind, name, status, config, webhook_token, verify_token, created_at')
    .eq('workspace_id', ws!).order('created_at')
  const bot = url.searchParams.get('bot_id')
  if (bot) q = q.eq('bot_id', bot)
  const rows = await must(q) as any[]
  return json({
    channels: rows.map(({ webhook_token, verify_token, ...r }) => ({ ...r, ...webhookInfo({ kind: r.kind, webhook_token, verify_token }) })),
    functions_url: publicFunctionsUrl(),
  })
})

router.on('PUT', '/channels/:id/secrets', async (req, params) => {
  const body = await readJson(req)
  const { db, user } = await auth(req, body.workspace_id, 'admin')
  const row = await must(db.from('bot_channels').select('*').eq('id', params.id).eq('workspace_id', body.workspace_id).maybeSingle())
  if (!row) throw notFound('Channel not found.')
  const current = row.secret_id ? JSON.parse(String((await db.rpc('read_secret', { p_id: row.secret_id })).data ?? '{}')) : {}
  const merged = { ...current, ...pickSecrets(row.kind, body.secrets, false) }
  const { error } = await db.rpc('store_secret', { p_secret: JSON.stringify(merged), p_name: `channel:${row.kind}`, p_existing: row.secret_id })
  if (error) throw new HttpError(500, 'vault', error.message)
  await audit(db, String(body.workspace_id), user.userId, 'channel.secrets_updated', 'channel', row.id)
  return json({ ok: true })
})

router.on('POST', '/channels/:id/test', async (req, params) => {
  const body = await readJson(req)
  const { db } = await auth(req, body.workspace_id, 'admin')
  const row = await must(db.from('bot_channels').select('*').eq('id', params.id).eq('workspace_id', body.workspace_id).maybeSingle()) as ChannelRow | null
  if (!row) throw notFound('Channel not found.')
  const to = String(body.to ?? '').trim()
  if (!/^\+?\d{7,15}$/.test(to)) throw badRequest('Enter a phone number in international format, e.g. +265991234567.')
  try {
    const id = await sendViaChannel(db, row, to, String(body.text ?? 'Test message from BotDesk.').slice(0, 300))
    return json({ ok: true, provider_message_id: id })
  } catch (err) {
    return json({ ok: false, error: (err as Error).message })
  }
})

// ── Invites ───────────────────────────────────────────────────────────────

router.on('POST', '/invites', async (req) => {
  const body = await readJson(req)
  const { db, user } = await auth(req, body.workspace_id, 'admin')
  // create_invite checks the role again under the user's own session.
  const { data: token, error } = await userDb(user.accessToken).rpc('create_invite', {
    p_workspace: body.workspace_id, p_email: String(body.email ?? ''), p_role: String(body.role ?? 'editor'),
  })
  if (error) throw badRequest(error.message)
  const base = env('DASHBOARD_URL') ?? new URL(req.headers.get('origin') ?? 'http://localhost:5173').origin
  const link = `${base}/invite/${token}`
  const ws = await must(db.from('workspaces').select('name').eq('id', body.workspace_id).single())
  const sent = await sendEmail(
    String(body.email),
    `You're invited to ${ws.name} on BotDesk`,
    `<p>${escapeHtml(user.email ?? 'A teammate')} invited you to join <b>${escapeHtml(ws.name)}</b> on BotDesk as ${escapeHtml(String(body.role ?? 'editor'))}.</p>` +
      `<p><a href="${link}">Accept the invite</a> (valid for 7 days).</p>`,
  ).catch(() => false)
  return json({ link, emailed: sent }, 201)
})

// ── Playground: test a bot without saving a conversation ─────────────────

/** Playground, analysis and test search call models: keep them to a sane pace per person. */
async function limitPerUser(db: Db, userId: string, what: string, perMinute: number) {
  const { data } = await db.rpc('hit_rate_limit', { p_key: `admin:${what}:${userId}`, p_limit: perMinute, p_window_seconds: 60 })
  if (data === false) throw new HttpError(429, 'rate_limited', 'Too many tries in a minute. Wait a moment and try again.')
}

router.on('POST', '/playground', async (req) => {
  const body = await readJson(req, 64_000)
  const db = serviceDb()
  const user = await requireUser(db, req)
  const bot = await must(db.from('bots').select('id, workspace_id').eq('id', body.bot_id).maybeSingle())
  if (!bot) throw notFound('Bot not found.')
  await requireRole(db, user.userId, bot.workspace_id, 'reviewer')
  const message = String(body.message ?? '').trim().slice(0, 4000)
  if (!message) throw badRequest('Type a message.')
  await limitPerUser(db, user.userId, 'playground', 30)
  await assertMessageQuota(db, bot.workspace_id)
  const modelOverride = await safeModelOverride(db, bot.workspace_id, body.model_override)
  const history = Array.isArray(body.history)
    ? body.history.slice(-12).filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    : []
  const ctx = await loadBotContext(db, bot.id, { fresh: true })
  const result = await answer({
    db, ctx, conversation: null, question: message, history, channel: body.channel === 'sms' || body.channel === 'whatsapp' ? body.channel : 'web',
    format: body.format === 'legal' ? 'legal' : body.format === 'text' ? 'text' : undefined,
    jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction.toUpperCase() : null,
    modelOverride, record: false,
  })
  // Tests on your own keys are free; on BotDesk's keys they count like real answers.
  recordUsage(db, {
    workspaceId: bot.workspace_id, botId: bot.id, kind: 'chat', provider: result.provider, model: result.model,
    input: result.usage.inputTokens, output: result.usage.outputTokens, platformKey: result.platformKey,
    messages: result.platformKey ? 1 : 0,
  })
  return json({ result })
})

router.on('POST', '/playground/analyze', async (req) => {
  const body = await readJson(req, 64_000)
  const db = serviceDb()
  const user = await requireUser(db, req)
  const bot = await must(db.from('bots').select('id, workspace_id').eq('id', body.bot_id).maybeSingle())
  if (!bot) throw notFound('Bot not found.')
  await requireRole(db, user.userId, bot.workspace_id, 'reviewer')
  const ctx = await loadBotContext(db, bot.id, { fresh: true })
  const text = String(body.text ?? '').trim()
  if (!text) throw badRequest('Paste a few lines of conversation.')
  await limitPerUser(db, user.userId, 'analyze', 30)
  await assertMessageQuota(db, bot.workspace_id)
  const { flags, model } = await analyzeSegment(db, ctx, { id: 'playground', text, start_ms: 0 }, {
    topic: typeof body.topic === 'string' ? body.topic.slice(0, 80) : null,
    jurisdiction: typeof body.jurisdiction === 'string' ? body.jurisdiction.toUpperCase().slice(0, 12) : null,
  })
  return json({ flags, model })
})

// ── Knowledge test search ─────────────────────────────────────────────────

router.on('POST', '/search', async (req) => {
  const body = await readJson(req, 16_000)
  const db = serviceDb()
  const user = await requireUser(db, req)
  const kb = await must(db.from('knowledge_bases').select('*').eq('id', body.knowledge_base_id).maybeSingle())
  if (!kb) throw notFound('Knowledge base not found.')
  await requireRole(db, user.userId, kb.workspace_id, 'viewer')
  const query = String(body.query ?? '').trim().slice(0, 1000)
  if (!query) throw badRequest('Type something to search for.')
  await limitPerUser(db, user.userId, 'search', 60)
  const topK = Math.min(20, Math.max(1, Number(body.top_k) || 8))
  const started = Date.now()
  const { considered } = await retrieve(db, kb.workspace_id, [kb], query, {
    topK,
    minScore: 0,
    jurisdiction: typeof body.jurisdiction === 'string' && body.jurisdiction ? body.jurisdiction.toUpperCase().slice(0, 12) : null,
  })
  return json({
    took_ms: Date.now() - started,
    results: considered.slice(0, topK).map((r) => ({
      chunk_id: r.chunk_id, source_id: r.source_id, title: r.title, section: r.section, heading: r.heading,
      citation: r.citation, url: r.url, jurisdiction: r.jurisdiction, content: r.content,
      vector_score: r.vector_score, text_score: r.text_score, score: r.score,
    })),
  })
})

// ── Training data export ──────────────────────────────────────────────────

router.on('GET', '/datasets/:id/export', async (req, params) => {
  const db = serviceDb()
  const user = await requireUser(db, req)
  const ds = await must(db.from('datasets').select('id, workspace_id, name').eq('id', params.id).maybeSingle())
  if (!ds) throw notFound('Dataset not found.')
  await requireRole(db, user.userId, ds.workspace_id, 'editor')
  const { jsonl, count } = await buildTrainingFile(db, ds.id)
  const name = ds.name.replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase() || 'dataset'
  return new Response(jsonl, {
    headers: {
      'content-type': 'application/jsonl; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.jsonl"`,
      'x-example-count': String(count),
      ...corsHeaders(req.headers.get('origin')),
      'access-control-expose-headers': 'x-example-count, content-disposition',
    },
  })
})

// ── Platform admin ────────────────────────────────────────────────────────

async function platformAdmin(req: Request) {
  const db = serviceDb()
  const user = await requireUser(db, req)
  const { data } = await db.from('profiles').select('is_platform_admin').eq('id', user.userId).maybeSingle()
  if (!data?.is_platform_admin) throw forbidden('Platform admins only.')
  return { db, user }
}

router.on('GET', '/platform/workspaces', async (req) => {
  const { db } = await platformAdmin(req)
  const period = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10)
  const [workspaces, usage, members] = await Promise.all([
    must(db.from('workspaces').select('id, name, slug, plan, features, created_at').order('created_at', { ascending: false }).limit(500)),
    must(db.from('usage_monthly').select('workspace_id, messages, cost_usd').eq('period', period)),
    must(db.from('workspace_members').select('workspace_id')),
  ])
  const u = new Map((usage as any[]).map((r) => [r.workspace_id, r]))
  const m = new Map<string, number>()
  for (const r of members as any[]) m.set(r.workspace_id, (m.get(r.workspace_id) ?? 0) + 1)
  return json({
    workspaces: (workspaces as any[]).map((w) => ({
      ...w, members: m.get(w.id) ?? 0, messages_this_month: u.get(w.id)?.messages ?? 0, cost_this_month: Number(u.get(w.id)?.cost_usd ?? 0),
    })),
  })
})

router.on('PATCH', '/platform/workspaces/:id', async (req, params) => {
  const { db, user } = await platformAdmin(req)
  const body = await readJson(req)
  const patch: Record<string, unknown> = {}
  if (typeof body.plan === 'string') {
    const plan = await must(db.from('plans').select('id').eq('id', body.plan).maybeSingle())
    if (!plan) throw badRequest('Unknown plan.')
    patch.plan = body.plan
  }
  if (body.features && typeof body.features === 'object') patch.features = body.features
  if (!Object.keys(patch).length) throw badRequest('Nothing to change.')
  const ws = await must(db.from('workspaces').update(patch).eq('id', params.id).select('id, plan, features').maybeSingle())
  if (!ws) throw notFound('Workspace not found.')
  await audit(db, params.id, user.userId, 'platform.workspace_updated', 'workspace', params.id, patch)
  return json({ workspace: ws })
})

// ── Server ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  try {
    const url = new URL(req.url)
    const match = router.match(req.method, Router.localPath(url, 'admin'))
    if (match === 'method') return json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405, cors)
    if (!match) return json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404, cors)
    const res = await match.handler(req, match.params, url)
    for (const [k, v] of Object.entries(cors)) if (!res.headers.has(k)) res.headers.set(k, v)
    return res
  } catch (err) {
    return errorResponse(err, cors)
  }
})
