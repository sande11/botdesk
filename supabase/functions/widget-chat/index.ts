/**
 * POST /functions/v1/widget-chat
 *
 * Handles each visitor message turn:
 * 1. Verify session token
 * 2. Rate limit check
 * 3. Embed user message → pgvector search → gpt-4o-mini synthesis
 * 4. Save both turns to messages table
 * 5. Return bot reply + escalation signal
 *
 * Body: { apiKey, conversationId, sessionToken, message, visitorId }
 * Response: { reply, escalationRequired, similarity }
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, handlePreflight, isOriginAllowed } from '../_shared/cors.ts'
import { validateApiKey, serviceClient, verifySessionToken, checkRateLimit } from '../_shared/auth.ts'
import { embed, synthesize, KBChunk } from '../_shared/openai.ts'

const MATCH_THRESHOLD = 0.60  // anything above this gets AI synthesis

serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  const origin = req.headers.get('origin')

  try {
    const { apiKey, conversationId, sessionToken, message, visitorId } = await req.json()

    // Input validation
    if (!message || typeof message !== 'string' || message.length > 1000) {
      return new Response(JSON.stringify({ error: 'Invalid message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    // Validate API key
    const app = await validateApiKey(apiKey)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    // CORS check
    if (!isOriginAllowed(origin, app.allowedDomains)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    // Verify session token
    const session = await verifySessionToken(sessionToken)
    if (!session || session.conversationId !== conversationId || session.visitorId !== visitorId) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    // Rate limit
    const allowed = await checkRateLimit(app.appId, visitorId, app.rateLimitPerMin)
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    const db = serviceClient()

    // ── "Yes" escalation detection ───────────────────────────────────────────
    // If the user is replying affirmatively to the bot's escalation prompt,
    // skip KB search and immediately trigger the escalation form.
    const lowerMsg = message.toLowerCase().trim()
    const isAffirmative = ['yes', 'yeah', 'sure', 'ok', 'yep', 'yup', 'please', 'connect me'].some(
      (w) => lowerMsg === w || lowerMsg.startsWith(w + ' ') || lowerMsg.startsWith(w + ',')
    )

    if (isAffirmative) {
      const { data: recentMsgs } = await db
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('ts', { ascending: false })
        .limit(3)

      const lastBotMsg = (recentMsgs ?? []).find((m: any) => m.role === 'bot')
      const wasEscalationPrompt = lastBotMsg?.content && (
        lastBotMsg.content.includes('connect you with our team') ||
        lastBotMsg.content.includes('connect you to our team') ||
        lastBotMsg.content.includes('connect you with the team')
      )

      if (wasEscalationPrompt) {
        const confirmReply = "I'll connect you with our team right away! Please fill in your contact details below."
        const now = new Date().toISOString()
        await db.from('messages').insert([
          { conversation_id: conversationId, role: 'user', content: message, ts: now },
          { conversation_id: conversationId, role: 'bot', content: confirmReply, ts: new Date(Date.now() + 100).toISOString() },
        ])
        await db.from('conversations').update({ escalated: true, tags: ['escalated'] }).eq('id', conversationId)
        return new Response(
          JSON.stringify({ reply: confirmReply, escalationRequired: true, similarity: 0 }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
        )
      }
    }

    // ── Normal KB flow ───────────────────────────────────────────────────────
    const { data: appRow } = await db
      .from('apps')
      .select('bot_name')
      .eq('id', app.appId)
      .single()

    const botName = appRow?.bot_name ?? 'Assistant'

    const queryEmbedding = await embed(message)
    const { data: matches } = await db.rpc('match_kb_entries', {
      p_app_id: app.appId,
      p_embedding: `[${queryEmbedding.join(',')}]`,
      p_threshold: MATCH_THRESHOLD,
      p_limit: 3,
    })

    const topMatch   = matches?.[0]
    const similarity = topMatch?.similarity ?? 0
    let reply: string
    let escalationRequired = false
    let matchedEntryId: string | null = null

    if (matches && matches.length > 0) {
      const chunks: KBChunk[] = (matches as any[]).map((m) => ({
        answer: m.answer,
        similarity: m.similarity,
      }))
      const synthesized = await synthesize(message, chunks, botName)
      if (synthesized !== null) {
        reply = synthesized
        matchedEntryId = topMatch.id
      } else {
        reply = app.outOfScopeMsg
        escalationRequired = true
      }
    } else {
      // No vector match — keyword fallback for entries with null embeddings
      const { data: kbEntries } = await db
        .from('kb_entries')
        .select('id, keywords, answer')
        .eq('app_id', app.appId)
        .eq('active', true)

      const hit = (kbEntries ?? []).find((e: any) =>
        (e.keywords ?? []).some((kw: string) => kw && lowerMsg.includes(kw.toLowerCase()))
      )

      if (hit) {
        const synthesized = await synthesize(message, [{ answer: hit.answer, similarity: 0.85 }], botName)
        if (synthesized !== null) {
          reply = synthesized
          matchedEntryId = hit.id
        } else {
          reply = app.outOfScopeMsg
          escalationRequired = true
        }
      } else {
        reply = app.outOfScopeMsg
        escalationRequired = true
      }
    }

    // Save user message + bot reply
    const now = new Date().toISOString()
    await db.from('messages').insert([
      {
        conversation_id: conversationId,
        role: 'user',
        content: message,
        ts: now,
      },
      {
        conversation_id: conversationId,
        role: 'bot',
        content: reply,
        kb_entry_id: matchedEntryId,
        similarity: similarity > 0 ? similarity : null,
        ts: new Date(Date.now() + 100).toISOString(),
      },
    ])

    // If escalation required, update conversation status and tags
    if (escalationRequired) {
      await db
        .from('conversations')
        .update({ escalated: true, tags: ['escalated'] })
        .eq('id', conversationId)
    }

    return new Response(
      JSON.stringify({ reply, escalationRequired, similarity }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      }
    )
  } catch (err) {
    console.error('widget-chat error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    })
  }
})
