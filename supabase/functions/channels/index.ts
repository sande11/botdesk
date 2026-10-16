/**
 * Webhooks for messaging channels — /functions/v1/channels/<kind>/<token>
 *
 *   whatsapp/<token>          GET: Meta verification, POST: messages
 *   twilio/<token>            POST: incoming SMS (form-encoded)
 *   africastalking/<token>    POST: incoming SMS (form-encoded)
 *
 * <token> is the channel's unguessable webhook token. WhatsApp and Twilio
 * requests are also signature-checked. Answers are generated after the
 * webhook is acknowledged, then sent through the provider's API.
 */
import {
  type ChannelKind,
  channelSecret,
  type ChannelRow,
  handleInbound,
  loadChannel,
} from '../_shared/channels/inbound.ts'
import {
  africasTalkingParse,
  EMPTY_TWIML,
  formToRecord,
  type Inbound,
  twilioParse,
  twilioSignatureOk,
  type TwilioSecret,
  whatsappParse,
  whatsappSignatureOk,
  type WhatsAppSecret,
  whatsappVerify,
} from '../_shared/channels/providers.ts'
import { serviceDb } from '../_shared/db.ts'
import { publicFunctionsUrl } from '../_shared/env.ts'
import { errorResponse, json } from '../_shared/http.ts'
import { background, log } from '../_shared/runtime.ts'

const KINDS: Record<string, ChannelKind> = {
  whatsapp: 'whatsapp',
  twilio: 'twilio_sms',
  africastalking: 'africastalking_sms',
}

function process(row: ChannelRow, messages: Inbound[]) {
  const db = serviceDb()
  background(
    (async () => {
      for (const m of messages) {
        try {
          await handleInbound(db, row, m)
        } catch (err) {
          log('error', 'inbound failed', { channel: row.id, error: String((err as Error).message) })
        }
      }
    })(),
  )
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const parts = url.pathname.replace(/^\/functions\/v1/, '').split('/').filter(Boolean) // [channels, kind, token]
    const kind = KINDS[parts[1] ?? '']
    const token = parts[2] ?? ''
    if (parts[0] !== 'channels' || !kind) return json({ error: 'not found' }, 404)

    const db = serviceDb()
    const row = await loadChannel(db, kind, token)
    if (!row) return json({ error: 'not found' }, 404)

    if (kind === 'whatsapp') {
      if (req.method === 'GET') {
        const challenge = whatsappVerify(url, row.verify_token)
        return challenge ? new Response(challenge, { status: 200 }) : new Response('forbidden', { status: 403 })
      }
      const raw = await req.text()
      const secret = await channelSecret<WhatsAppSecret>(db, row)
      if (!(await whatsappSignatureOk(raw, req.headers.get('x-hub-signature-256'), secret.app_secret))) {
        log('warn', 'whatsapp signature mismatch', { channel: row.id })
        return new Response('invalid signature', { status: 401 })
      }
      const msgs = whatsappParse(JSON.parse(raw), String(row.config.phone_number_id ?? ''))
      if (msgs.length) process(row, msgs)
      return json({ ok: true }) // Meta retries anything but 200
    }

    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
    const params = formToRecord(new URLSearchParams(await req.text()))

    if (kind === 'twilio_sms') {
      const secret = await channelSecret<TwilioSecret>(db, row)
      // Twilio signs the exact URL configured in its console.
      const signedUrl = `${publicFunctionsUrl()}/channels/twilio/${token}${url.search}`
      if (!(await twilioSignatureOk(signedUrl, params, req.headers.get('x-twilio-signature'), secret.auth_token))) {
        log('warn', 'twilio signature mismatch', { channel: row.id })
        return new Response('invalid signature', { status: 403 })
      }
      const m = twilioParse(params)
      if (m) process(row, [m])
      return new Response(EMPTY_TWIML, { headers: { 'content-type': 'text/xml' } })
    }

    // Africa's Talking
    const m = africasTalkingParse(params)
    if (m) process(row, [m])
    return new Response('OK', { status: 200 })
  } catch (err) {
    return errorResponse(err)
  }
})
