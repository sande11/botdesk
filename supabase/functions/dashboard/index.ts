/**
 * Dashboard API — all /dashboard/* routes.
 * Protected by Supabase JWT (Authorization: Bearer <supabase-session-token>).
 * Uses the service-role client for all DB writes (the function is already
 * server-side authenticated code; ownership is enforced via explicit user_id checks).
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, handlePreflight } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'
import { embed, synthesize } from '../_shared/openai.ts'

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function generateApiKey(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `bdk_live_${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Extract the authenticated user ID from the Bearer token. */
async function getUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const sdb = serviceClient()
  const { data, error } = await sdb.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

/** Get or create the accounts row for this user. */
async function getOrCreateAccount(userId: string, userEmail?: string): Promise<string | null> {
  const sdb = serviceClient()
  const { data: existing } = await sdb
    .from('accounts').select('id').eq('owner_id', userId).single()
  if (existing) return existing.id

  const { data: created, error } = await sdb
    .from('accounts')
    .insert({ owner_id: userId, display_name: userEmail ?? '' })
    .select('id').single()
  if (error || !created) return null
  return created.id
}

/**
 * Ownership check: returns true if userId owns the given appId.
 * Moved to module level so it isn't a function-in-block (which can confuse Deno's
 * strict-mode hoisting and break the surrounding try-block control flow).
 */
async function ownedApp(
  sdb: ReturnType<typeof serviceClient>,
  userId: string,
  appId: string,
): Promise<boolean> {
  const { data: account } = await sdb
    .from('accounts').select('id').eq('owner_id', userId).single()
  if (!account) return false
  const { data } = await sdb
    .from('apps').select('id').eq('id', appId).eq('account_id', account.id).single()
  return !!data
}

async function embedKBEntry(entryId: string, keywords: string[], answer: string) {
  const text = `${keywords.join(' ')} ${answer}`.slice(0, 8000)
  const embedding = await embed(text)
  await serviceClient().from('kb_entries').update({ embedding: `[${embedding.join(',')}]` }).eq('id', entryId)
}

serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  const origin     = req.headers.get('origin')
  const authHeader = req.headers.get('authorization')
  const headers    = { 'Content-Type': 'application/json', ...corsHeaders(origin) }

  const userId = await getUserId(authHeader)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
  }

  const url    = new URL(req.url)
  const method = req.method
  const sdb    = serviceClient()

  // Strip the function path prefix — handle /functions/v1/dashboard/X or /dashboard/X
  const rawPath = url.pathname
  const path = rawPath
    .replace(/^\/functions\/v1\/dashboard/, '')
    .replace(/^\/dashboard/, '')
    || '/'

  try {
    // ── GET /apps ─────────────────────────────────────────────────
    if (method === 'GET' && path === '/apps') {
      const { data: account } = await sdb.from('accounts').select('id').eq('owner_id', userId).single()
      if (!account) return new Response(JSON.stringify([]), { status: 200, headers })

      const { data, error } = await sdb
        .from('apps')
        .select(`*, app_settings(*), app_api_keys(id, key_prefix, active, created_at, last_used_at), kb_entries(id, keywords, answer, tags, active, created_at, updated_at)`)
        .eq('account_id', account.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return new Response(JSON.stringify(data ?? []), { status: 200, headers })
    }

    // ── POST /apps ────────────────────────────────────────────────
    if (method === 'POST' && path === '/apps') {
      const body = await req.json()
      const accountId = await getOrCreateAccount(userId)
      if (!accountId) throw new Error('Could not resolve account')

      const { data: app, error: appErr } = await sdb
        .from('apps')
        .insert({
          account_id:      accountId,
          name:            body.name,
          url:             body.url ?? '',
          primary_color:   body.primaryColor ?? '#7c6df8',
          bot_name:        body.botName ?? 'Assistant',
          welcome_message: body.welcomeMessage ?? 'Hi! How can I help you today?',
          position:        body.position ?? 'bottom-right',
        })
        .select().single()
      if (appErr) throw appErr

      await sdb.from('app_settings').insert({ app_id: app.id })

      const rawKey = generateApiKey()
      await sdb.from('app_api_keys').insert({
        app_id:     app.id,
        key_prefix: rawKey.slice(0, 16),
        key_hash:   await sha256(rawKey),
      })

      return new Response(JSON.stringify({ ...app, apiKey: rawKey }), { status: 201, headers })
    }

    // ── PATCH /apps/:appId ────────────────────────────────────────
    const appMatch = path.match(/^\/apps\/([^/]+)$/)
    if (method === 'PATCH' && appMatch) {
      const appId = appMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const body = await req.json()
      const { data, error } = await sdb.from('apps')
        .update({ name: body.name, url: body.url, primary_color: body.primaryColor, bot_name: body.botName, welcome_message: body.welcomeMessage, active: body.active, position: body.position })
        .eq('id', appId).select().single()
      if (error) throw error
      return new Response(JSON.stringify(data), { status: 200, headers })
    }

    // ── DELETE /apps/:appId ───────────────────────────────────────
    if (method === 'DELETE' && appMatch) {
      const appId = appMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const { error } = await sdb.from('apps').delete().eq('id', appId)
      if (error) throw error
      return new Response(JSON.stringify({ success: true }), { status: 200, headers })
    }

    // ── KB: GET /apps/:appId/kb ───────────────────────────────────
    const kbListMatch = path.match(/^\/apps\/([^/]+)\/kb$/)
    if (method === 'GET' && kbListMatch) {
      const appId = kbListMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const { data, error } = await sdb.from('kb_entries')
        .select('id, keywords, answer, tags, active, created_at, updated_at')
        .eq('app_id', appId).order('created_at', { ascending: false })
      if (error) throw error
      return new Response(JSON.stringify(data), { status: 200, headers })
    }

    // ── KB: POST /apps/:appId/kb ──────────────────────────────────
    if (method === 'POST' && kbListMatch) {
      const appId = kbListMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const body = await req.json()
      const { data: entry, error: entryErr } = await sdb.from('kb_entries')
        .insert({ app_id: appId, keywords: body.keywords ?? [], answer: body.answer, tags: body.tags ?? [] })
        .select().single()
      if (entryErr) throw entryErr

      await embedKBEntry(entry.id, body.keywords, body.answer).catch(console.error)
      return new Response(JSON.stringify(entry), { status: 201, headers })
    }

    // ── KB: PATCH /apps/:appId/kb/:entryId ───────────────────────
    const kbEntryMatch = path.match(/^\/apps\/([^/]+)\/kb\/([^/]+)$/)
    if (method === 'PATCH' && kbEntryMatch) {
      const [, appId, entryId] = kbEntryMatch
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const body = await req.json()
      const updateFields: Record<string, unknown> = {}
      if (body.keywords !== undefined) updateFields.keywords = body.keywords
      if (body.answer   !== undefined) updateFields.answer   = body.answer
      if (body.tags     !== undefined) updateFields.tags     = body.tags
      if (body.active   !== undefined) updateFields.active   = body.active
      const { data, error } = await sdb.from('kb_entries')
        .update(updateFields).eq('id', entryId).eq('app_id', appId).select().single()
      if (error) throw error
      if (body.keywords !== undefined || body.answer !== undefined) {
        await embedKBEntry(entryId, data.keywords, data.answer).catch(console.error)
      }
      return new Response(JSON.stringify(data), { status: 200, headers })
    }

    // ── KB: DELETE /apps/:appId/kb/:entryId ──────────────────────
    if (method === 'DELETE' && kbEntryMatch) {
      const [, appId, entryId] = kbEntryMatch
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const { error } = await sdb.from('kb_entries').delete().eq('id', entryId).eq('app_id', appId)
      if (error) throw error
      return new Response(JSON.stringify({ success: true }), { status: 200, headers })
    }

    // ── Settings: GET /apps/:appId/settings ──────────────────────
    const settingsMatch = path.match(/^\/apps\/([^/]+)\/settings$/)
    if (method === 'GET' && settingsMatch) {
      const appId = settingsMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const { data, error } = await sdb.from('app_settings').select('*').eq('app_id', appId).single()
      if (error) throw error
      return new Response(JSON.stringify(data), { status: 200, headers })
    }

    // ── Settings: PATCH /apps/:appId/settings ────────────────────
    if (method === 'PATCH' && settingsMatch) {
      const appId = settingsMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const body = await req.json()
      const { data, error } = await sdb.from('app_settings')
        .update({ out_of_scope_msg: body.outOfScopeMsg, escalation_email: body.escalationEmail, escalation_phone: body.escalationPhone, rate_limit_per_min: body.rateLimitPerMin, rate_limit_per_day: body.rateLimitPerDay, allowed_domains: body.allowedDomains })
        .eq('app_id', appId).select().single()
      if (error) throw error
      return new Response(JSON.stringify(data), { status: 200, headers })
    }

    // ── Keys: GET /apps/:appId/keys ──────────────────────────────
    const keysMatch = path.match(/^\/apps\/([^/]+)\/keys$/)
    if (method === 'GET' && keysMatch) {
      const appId = keysMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const { data, error } = await sdb.from('app_api_keys')
        .select('id, key_prefix, active, created_at, revoked_at, last_used_at')
        .eq('app_id', appId).order('created_at', { ascending: false })
      if (error) throw error
      return new Response(JSON.stringify(data), { status: 200, headers })
    }

    // ── Keys: POST /apps/:appId/keys ─────────────────────────────
    if (method === 'POST' && keysMatch) {
      const appId = keysMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const rawKey = generateApiKey()
      await sdb.from('app_api_keys').update({ active: false, revoked_at: new Date().toISOString() }).eq('app_id', appId).eq('active', true)
      const { data, error } = await sdb.from('app_api_keys')
        .insert({ app_id: appId, key_prefix: rawKey.slice(0, 16), key_hash: await sha256(rawKey) })
        .select('id, key_prefix, created_at').single()
      if (error) throw error
      return new Response(JSON.stringify({ ...data, apiKey: rawKey }), { status: 201, headers })
    }

    // ── Keys: DELETE /apps/:appId/keys/:keyId ────────────────────
    const keyRevokeMatch = path.match(/^\/apps\/([^/]+)\/keys\/([^/]+)$/)
    if (method === 'DELETE' && keyRevokeMatch) {
      const [, appId, keyId] = keyRevokeMatch
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const { error } = await sdb.from('app_api_keys')
        .update({ active: false, revoked_at: new Date().toISOString() }).eq('id', keyId).eq('app_id', appId)
      if (error) throw error
      return new Response(JSON.stringify({ success: true }), { status: 200, headers })
    }

    // ── Preview chat: POST /apps/:appId/preview-chat ─────────────
    const previewChatMatch = path.match(/^\/apps\/([^/]+)\/preview-chat$/)
    if (method === 'POST' && previewChatMatch) {
      const appId = previewChatMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const body = await req.json()
      const userMessage = ((body.message ?? '') as string).slice(0, 1000).trim()
      if (!userMessage) {
        return new Response(JSON.stringify({ error: 'message required' }), { status: 400, headers })
      }

      // Fetch app bot name and out-of-scope message in parallel
      const [appRes, settingsRes] = await Promise.all([
        sdb.from('apps').select('bot_name').eq('id', appId).single(),
        sdb.from('app_settings').select('out_of_scope_msg').eq('app_id', appId).single(),
      ])
      const botName     = (appRes.data as any)?.bot_name ?? 'Assistant'
      const oosMsg      = (settingsRes.data as any)?.out_of_scope_msg
        ?? "I don't have that information yet. Let me connect you with our team!"

      // Embed → vector search
      const embedding = await embed(userMessage)
      const { data: matches } = await sdb.rpc('match_kb_entries', {
        p_app_id:    appId,
        p_embedding: `[${embedding.join(',')}]`,
        p_threshold: 0.70,
        p_limit:     3,
      })

      let reply: string
      let escalationRequired = false

      if (matches && matches.length > 0 && (matches[0] as any).similarity >= 0.82) {
        reply = await synthesize(userMessage, matches as any[], botName)
      } else if (matches && matches.length > 0) {
        reply = (matches[0] as any).answer
      } else {
        // Keyword fallback — handles existing entries whose embedding is still null.
        // Fetch active KB entries and check if any keyword appears in the user message.
        const lowerMsg = userMessage.toLowerCase()
        const { data: kbEntries } = await sdb
          .from('kb_entries')
          .select('id, keywords, answer')
          .eq('app_id', appId)
          .eq('active', true)

        const hit = (kbEntries ?? []).find((e: any) =>
          (e.keywords ?? []).some((kw: string) => kw && lowerMsg.includes(kw.toLowerCase()))
        )

        if (hit) {
          reply = await synthesize(userMessage, [{ ...hit, similarity: 0.85 }], botName)
        } else {
          reply = oosMsg
          escalationRequired = true
        }
      }

      return new Response(JSON.stringify({ reply, escalationRequired }), { status: 200, headers })
    }

    // ── KB: POST /apps/:appId/kb/reembed ─────────────────────────
    const reembedMatch = path.match(/^\/apps\/([^/]+)\/kb\/reembed$/)
    if (method === 'POST' && reembedMatch) {
      const appId = reembedMatch[1]
      if (!await ownedApp(sdb, userId, appId)) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }
      const { data: entries } = await sdb
        .from('kb_entries')
        .select('id, keywords, answer')
        .eq('app_id', appId)
        .eq('active', true)
        .is('embedding', null)
        .limit(30) // prevent timeout on large KBs

      let reembedded = 0
      for (const entry of (entries ?? [])) {
        await embedKBEntry(entry.id, entry.keywords, entry.answer).catch(console.error)
        reembedded++
      }
      return new Response(JSON.stringify({ reembedded }), { status: 200, headers })
    }

    // ── Conversations: GET /conversations ─────────────────────────
    if (method === 'GET' && path === '/conversations') {
      const { data: account } = await sdb.from('accounts').select('id').eq('owner_id', userId).single()
      if (!account) return new Response(JSON.stringify([]), { status: 200, headers })

      const { data: userApps } = await sdb.from('apps').select('id').eq('account_id', account.id)
      const appIds = (userApps ?? []).map((a: any) => a.id)
      if (appIds.length === 0) return new Response(JSON.stringify([]), { status: 200, headers })

      const { data, error } = await sdb
        .from('conversations')
        .select('*, messages(id, role, content, ts)')
        .in('app_id', appIds)
        .is('deleted_at', null)
        .order('last_message', { ascending: false })
        .limit(100)
      if (error) throw error
      return new Response(JSON.stringify(data ?? []), { status: 200, headers })
    }

    // ── Conversations: PATCH /conversations/:id/resolve ───────────
    const convResolveMatch = path.match(/^\/conversations\/([^/]+)\/resolve$/)
    if (method === 'PATCH' && convResolveMatch) {
      const convId = convResolveMatch[1]
      const { data: account } = await sdb.from('accounts').select('id').eq('owner_id', userId).single()
      if (!account) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })

      const { data: userApps } = await sdb.from('apps').select('id').eq('account_id', account.id)
      const appIds = (userApps ?? []).map((a: any) => a.id)
      const { data: conv } = await sdb.from('conversations').select('id').eq('id', convId).in('app_id', appIds).single()
      if (!conv) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })

      const { data, error } = await sdb
        .from('conversations').update({ status: 'resolved' }).eq('id', convId).select().single()
      if (error) throw error
      return new Response(JSON.stringify(data), { status: 200, headers })
    }

    // ── Analytics: GET /analytics/overview ───────────────────────
    if (method === 'GET' && path === '/analytics/overview') {
      const { data: account } = await sdb.from('accounts').select('id').eq('owner_id', userId).single()
      if (!account) return new Response(JSON.stringify({ stats: [], dailyVolume: [] }), { status: 200, headers })

      const { data: apps } = await sdb.from('apps').select('id').eq('account_id', account.id)
      const appIds = (apps ?? []).map((a: any) => a.id)
      if (appIds.length === 0) return new Response(JSON.stringify({ stats: [], dailyVolume: [] }), { status: 200, headers })

      const [{ count: totalConvs }, { count: escalatedCount }] = await Promise.all([
        sdb.from('conversations').select('id', { count: 'exact', head: true }).in('app_id', appIds).is('deleted_at', null),
        sdb.from('conversations').select('id', { count: 'exact', head: true }).in('app_id', appIds).eq('status', 'escalated').is('deleted_at', null),
      ])

      return new Response(JSON.stringify({
        stats: [
          { label: 'Total Conversations', value: String(totalConvs ?? 0) },
          { label: 'Escalated',           value: String(escalatedCount ?? 0) },
        ],
        dailyVolume: [],
      }), { status: 200, headers })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
  } catch (err: any) {
    console.error('dashboard error:', err)
    return new Response(JSON.stringify({ error: err.message ?? 'Internal server error' }), { status: 500, headers })
  }
})
