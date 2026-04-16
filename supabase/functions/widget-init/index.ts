/**
 * POST /functions/v1/widget-init
 *
 * Called once when the widget loads on a third-party page.
 * Validates the API key, enforces CORS, creates/resumes a conversation,
 * and returns a session token + bot config.
 *
 * Body: { apiKey, visitorId, pageUrl }
 * Response: { conversationId, sessionToken, botName, primaryColor, welcomeMessage, position }
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, handlePreflight, isOriginAllowed } from '../_shared/cors.ts'
import { validateApiKey, serviceClient, generateSessionToken } from '../_shared/auth.ts'

serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  const origin = req.headers.get('origin')

  try {
    const { apiKey, visitorId, pageUrl } = await req.json()

    // Validate key
    const app = await validateApiKey(apiKey)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    // Enforce CORS
    if (!isOriginAllowed(origin, app.allowedDomains)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    const db = serviceClient()

    // Fetch app config
    const { data: appRow } = await db
      .from('apps')
      .select('bot_name, primary_color, welcome_message, position')
      .eq('id', app.appId)
      .eq('active', true)
      .single()

    if (!appRow) {
      return new Response(JSON.stringify({ error: 'App not found or inactive' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    // Resume latest active conversation or create a new one
    const { data: existing } = await db
      .from('conversations')
      .select('id')
      .eq('app_id', app.appId)
      .eq('visitor_id', visitorId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    let conversationId: string
    if (existing) {
      conversationId = existing.id
    } else {
      const { data: newConv, error: convErr } = await db
        .from('conversations')
        .insert({
          app_id: app.appId,
          visitor_id: visitorId,
          visitor_name: 'Visitor',
          channel: 'web',
        })
        .select('id')
        .single()

      if (convErr || !newConv) {
        throw new Error('Failed to create conversation')
      }
      conversationId = newConv.id
    }

    const sessionToken = await generateSessionToken(conversationId, visitorId)

    return new Response(
      JSON.stringify({
        conversationId,
        sessionToken,
        botName: appRow.bot_name,
        primaryColor: appRow.primary_color,
        welcomeMessage: appRow.welcome_message,
        position: appRow.position,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      }
    )
  } catch (err) {
    console.error('widget-init error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    })
  }
})
