/**
 * POST /functions/v1/widget-escalate
 *
 * Triggered when a visitor requests human escalation.
 * 1. Verify session token
 * 2. Update conversation status to 'escalated'
 * 3. Send email via Resend + WhatsApp via Meta Cloud API
 * 4. Record delivery in escalations table
 *
 * Body: { apiKey, conversationId, sessionToken, visitorId, visitorName?, visitorEmail?, visitorPhone? }
 * Response: { success: true }
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, handlePreflight, isOriginAllowed } from '../_shared/cors.ts'
import { validateApiKey, serviceClient, verifySessionToken } from '../_shared/auth.ts'

const RESEND_API_KEY     = Deno.env.get('RESEND_API_KEY')!
const RESEND_FROM        = Deno.env.get('ESCALATION_FROM_EMAIL') ?? 'noreply@botdesk.ai'
const WHATSAPP_TOKEN     = Deno.env.get('WHATSAPP_TOKEN')
const WHATSAPP_PHONE_ID  = Deno.env.get('WHATSAPP_PHONE_ID')

serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  const origin = req.headers.get('origin')

  try {
    const {
      apiKey, conversationId, sessionToken, visitorId,
      visitorName, visitorEmail, visitorPhone,
    } = await req.json()

    // Validate key
    const app = await validateApiKey(apiKey)
    if (!app) {
      return new Response(JSON.stringify({ error: 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    // CORS
    if (!isOriginAllowed(origin, app.allowedDomains)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    // Session
    const session = await verifySessionToken(sessionToken)
    if (!session || session.conversationId !== conversationId || session.visitorId !== visitorId) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      })
    }

    const db = serviceClient()

    // Get last 5 messages for the email transcript
    const { data: messages } = await db
      .from('messages')
      .select('role, content, ts')
      .eq('conversation_id', conversationId)
      .order('ts', { ascending: false })
      .limit(5)

    const transcript = (messages ?? [])
      .reverse()
      .map((m: any) => `[${m.role.toUpperCase()}] ${m.content}`)
      .join('\n')

    // Update conversation status
    await db
      .from('conversations')
      .update({
        status: 'escalated',
        escalated: true,
        visitor_name: visitorName ?? 'Visitor',
        visitor_email: visitorEmail ?? null,
        tags: ['escalated'],
      })
      .eq('id', conversationId)

    // Insert system escalation message
    await db.from('messages').insert({
      conversation_id: conversationId,
      role: 'escalation',
      content: `Escalated to human agent${visitorEmail ? ` · ${visitorEmail} notified via email` : ''}`,
    })

    // Send email via Resend
    let emailStatus: 'sent' | 'failed' = 'failed'
    let emailRef: string | null = null
    let emailError: string | null = null

    if (app.escalationEmail && RESEND_API_KEY) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: app.escalationEmail,
            subject: `[BotDesk] Escalation from ${visitorName ?? 'Visitor'}`,
            text: [
              `A visitor needs human support.`,
              `Visitor: ${visitorName ?? 'Unknown'}`,
              visitorEmail ? `Email: ${visitorEmail}` : '',
              `Conversation ID: ${conversationId}`,
              '',
              '--- Last 5 messages ---',
              transcript,
            ].filter(Boolean).join('\n'),
          }),
        })
        if (emailRes.ok) {
          const emailData = await emailRes.json()
          emailStatus = 'sent'
          emailRef = emailData.id
        } else {
          emailError = await emailRes.text()
        }
      } catch (e: any) {
        emailError = e.message
      }

      await db.from('escalations').insert({
        conversation_id: conversationId,
        channel: 'email',
        recipient: app.escalationEmail,
        status: emailStatus,
        provider_ref: emailRef,
        sent_at: emailStatus === 'sent' ? new Date().toISOString() : null,
        error: emailError,
      })
    }

    // Send WhatsApp via Meta Cloud API
    if (app.escalationPhone && WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
      let waStatus: 'sent' | 'failed' = 'failed'
      let waRef: string | null = null
      let waError: string | null = null
      try {
        const waRes = await fetch(
          `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: app.escalationPhone,
              type: 'template',
              template: {
                name: 'botdesk_escalation',
                language: { code: 'en_US' },
                components: [
                  {
                    type: 'body',
                    parameters: [
                      { type: 'text', text: visitorName ?? 'Visitor' },
                      { type: 'text', text: conversationId },
                    ],
                  },
                ],
              },
            }),
          }
        )
        if (waRes.ok) {
          const waData = await waRes.json()
          waStatus = 'sent'
          waRef = waData.messages?.[0]?.id
        } else {
          waError = await waRes.text()
        }
      } catch (e: any) {
        waError = e.message
      }

      await db.from('escalations').insert({
        conversation_id: conversationId,
        channel: 'whatsapp',
        recipient: app.escalationPhone,
        status: waStatus,
        provider_ref: waRef,
        sent_at: waStatus === 'sent' ? new Date().toISOString() : null,
        error: waError,
      })
    }

    // Always return success — widget shows "team notified" regardless of delivery details
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    })
  } catch (err) {
    console.error('widget-escalate error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    })
  }
})
