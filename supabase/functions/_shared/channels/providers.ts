/**
 * WhatsApp Cloud API, Twilio SMS and Africa's Talking SMS: webhook
 * verification, inbound parsing and sending.
 */
import { hmacSha1, hmacSha256, timingSafeEqual, toBase64, toHex } from '../crypto.ts'

export interface Inbound {
  from: string
  text: string
  messageId: string
  name?: string | null
  /** Set when the message isn't text (image, voice note...). */
  unsupported?: string
}

export class SendError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message)
  }
}

async function sendCheck(res: Response, provider: string): Promise<any> {
  const text = await res.text()
  let body: any = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.message ?? body?.SMSMessageData?.Message ?? String(text).slice(0, 200)
    throw new SendError(`${provider} refused the message (${res.status}): ${msg}`, res.status >= 500 || res.status === 429)
  }
  return body
}

// ── WhatsApp Cloud API ────────────────────────────────────────────────────

export const WHATSAPP_GRAPH_VERSION = 'v25.0'

export interface WhatsAppConfig {
  phone_number_id: string
  graph_version?: string
}
export interface WhatsAppSecret {
  access_token: string
  app_secret: string
}

/** GET handshake: returns hub.challenge when the verify token matches. */
export function whatsappVerify(url: URL, verifyToken: string): string | null {
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token') ?? ''
  const challenge = url.searchParams.get('hub.challenge')
  if (mode === 'subscribe' && challenge && timingSafeEqual(token, verifyToken)) return challenge
  return null
}

/** X-Hub-Signature-256: "sha256=" + hex HMAC of the raw body with the app secret. */
export async function whatsappSignatureOk(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false
  const expected = 'sha256=' + toHex(await hmacSha256(appSecret, rawBody))
  return timingSafeEqual(header, expected)
}

export function whatsappParse(payload: any, phoneNumberId: string): Inbound[] {
  const out: Inbound[] = []
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value
      if (change?.field !== 'messages' || !v?.messages) continue
      if (v.metadata?.phone_number_id && v.metadata.phone_number_id !== phoneNumberId) continue
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]))
      for (const m of v.messages) {
        const base = { from: String(m.from), messageId: String(m.id), name: names.get(m.from) ?? null }
        if (m.type === 'text') out.push({ ...base, text: String(m.text?.body ?? '') })
        else if (m.type === 'button') out.push({ ...base, text: String(m.button?.text ?? '') })
        else if (m.type === 'interactive') {
          out.push({ ...base, text: String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '') })
        } else out.push({ ...base, text: '', unsupported: String(m.type) })
      }
    }
  }
  return out
}

export async function whatsappSend(cfg: WhatsAppConfig, secret: WhatsAppSecret, to: string, text: string): Promise<string> {
  const version = cfg.graph_version || WHATSAPP_GRAPH_VERSION
  const res = await fetch(`https://graph.facebook.com/${version}/${cfg.phone_number_id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret.access_token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text.slice(0, 4096), preview_url: false },
    }),
  })
  const body = await sendCheck(res, 'WhatsApp')
  return body?.messages?.[0]?.id ?? ''
}

// ── Twilio SMS ────────────────────────────────────────────────────────────

export interface TwilioConfig {
  account_sid: string
  from_number: string
}
export interface TwilioSecret {
  auth_token: string
}

/** URL + params sorted by name, concatenated, HMAC-SHA1 with the auth token, base64. */
export async function twilioSignature(url: string, params: Record<string, string>, authToken: string): Promise<string> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('')
  return toBase64(await hmacSha1(authToken, data))
}

export async function twilioSignatureOk(
  url: string,
  params: Record<string, string>,
  header: string | null,
  authToken: string,
): Promise<boolean> {
  if (!header) return false
  return timingSafeEqual(header, await twilioSignature(url, params, authToken))
}

export function twilioParse(params: Record<string, string>): Inbound | null {
  if (!params.From || !params.MessageSid) return null
  const media = Number(params.NumMedia ?? '0')
  return {
    from: params.From,
    text: params.Body ?? '',
    messageId: params.MessageSid,
    unsupported: !params.Body && media > 0 ? 'media' : undefined,
  }
}

export async function twilioSend(cfg: TwilioConfig, secret: TwilioSecret, to: string, text: string): Promise<string> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.account_sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + btoa(`${cfg.account_sid}:${secret.auth_token}`),
    },
    body: new URLSearchParams({ From: cfg.from_number, To: to, Body: text.slice(0, 1600) }),
  })
  const body = await sendCheck(res, 'Twilio')
  return body?.sid ?? ''
}

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

// ── Africa's Talking SMS ──────────────────────────────────────────────────
// Africa's Talking does not sign callbacks; the unguessable token in the
// callback URL authenticates them.

export interface AfricasTalkingConfig {
  username: string
  from?: string
  sandbox?: boolean
}
export interface AfricasTalkingSecret {
  api_key: string
}

export function africasTalkingParse(params: Record<string, string>): Inbound | null {
  if (!params.from || !params.id) return null
  return { from: params.from, text: params.text ?? '', messageId: params.id }
}

export async function africasTalkingSend(
  cfg: AfricasTalkingConfig,
  secret: AfricasTalkingSecret,
  to: string,
  text: string,
): Promise<string> {
  const host = cfg.sandbox ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com'
  const form = new URLSearchParams({ username: cfg.username, to, message: text.slice(0, 1600) })
  if (cfg.from) form.set('from', cfg.from)
  const res = await fetch(`${host}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey: secret.api_key, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const body = await sendCheck(res, "Africa's Talking")
  const r = body?.SMSMessageData?.Recipients?.[0]
  if (r && r.status && !/success/i.test(r.status)) {
    throw new SendError(`Africa's Talking could not deliver: ${r.status}`, false)
  }
  return r?.messageId ?? ''
}

export function formToRecord(form: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of form) out[k] = v
  return out
}
