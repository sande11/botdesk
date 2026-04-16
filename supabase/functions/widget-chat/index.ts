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

const HIGH_CONFIDENCE = 0.82
const LOW_CONFIDENCE  = 0.70

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

    // Fetch bot name for synthesis
    const { data: appRow } = await db
      .from('apps')
      .select('bot_name')
      .eq('id', app.appId)
      .single()

    // Embed user query and search KB
    const queryEmbedding = await embed(message)
    const { data: matches } = await db.rpc('match_kb_entries', {
      p_app_id: app.appId,
      p_embedding: `[${queryEmbedding.join(',')}]`,
      p_threshold: LOW_CONFIDENCE,
      p_limit: 3,
    })

    const topMatch   = matches?.[0]
    const similarity = topMatch?.similarity ?? 0
    let reply: string
    let escalationRequired = false
    let matchedEntryId: string | null = null

    if (similarity >= HIGH_CONFIDENCE) {
      // High confidence: synthesize from KB chunks
      const chunks: KBChunk[] = (matches as any[]).map((m) => ({
        answer: m.answer,
        similarity: m.similarity,
      }))
      reply = await synthesize(message, chunks, appRow?.bot_name ?? 'Assistant')
      matchedEntryId = topMatch.id
    } else if (similarity >= LOW_CONFIDENCE) {
      // Medium confidence: answer + confirmation nudge
      reply = `${topMatch.answer}\n\nIs that what you were looking for? If not, I can connect you with our team.`
      matchedEntryId = topMatch.id
    } else {
      // Below threshold: out-of-scope, escalate
      reply = app.outOfScopeMsg
      escalationRequired = true
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
