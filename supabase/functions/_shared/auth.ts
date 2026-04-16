/**
 * API key and session token validation helpers.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SESSION_SECRET = Deno.env.get('SESSION_SECRET')!

/** Service-role Supabase client — bypasses RLS, use only in Edge Functions */
export function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY)
}

/** SHA-256 hex of an arbitrary string */
async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  )
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface AppContext {
  appId: string
  allowedDomains: string[]
  rateLimitPerMin: number
  outOfScopeMsg: string
  escalationEmail: string | null
  escalationPhone: string | null
}

/**
 * Validate a bdk_live_* API key.
 * Returns app context or null if invalid.
 */
export async function validateApiKey(rawKey: string): Promise<AppContext | null> {
  if (!rawKey || !/^bdk_live_[0-9a-f]{24}$/.test(rawKey)) return null

  const hash = await sha256(rawKey)
  const db = serviceClient()

  const { data, error } = await db
    .from('app_api_keys')
    .select(`
      app_id,
      app_settings!inner (
        allowed_domains,
        rate_limit_per_min,
        out_of_scope_msg,
        escalation_email,
        escalation_phone
      )
    `)
    .eq('key_hash', hash)
    .eq('active', true)
    .single()

  if (error || !data) return null

  // Fire-and-forget: update last_used_at
  db.from('app_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', hash)

  const s = (data as any).app_settings
  return {
    appId: data.app_id,
    allowedDomains: s.allowed_domains ?? [],
    rateLimitPerMin: s.rate_limit_per_min ?? 10,
    outOfScopeMsg: s.out_of_scope_msg,
    escalationEmail: s.escalation_email,
    escalationPhone: s.escalation_phone,
  }
}

/**
 * Generate a stateless HMAC-SHA256 session token.
 * Format: <payload>.<hex-signature>
 */
export async function generateSessionToken(conversationId: string, visitorId: string): Promise<string> {
  const payload = `${conversationId}:${visitorId}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${payload}.${hex}`
}

/**
 * Verify a session token. Returns { conversationId, visitorId } or null.
 */
export async function verifySessionToken(
  token: string
): Promise<{ conversationId: string; visitorId: string } | null> {
  const lastDot = token.lastIndexOf('.')
  if (lastDot === -1) return null

  const payload = token.slice(0, lastDot)
  const providedHex = token.slice(lastDot + 1)
  const parts = payload.split(':')
  if (parts.length !== 2) return null

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const expectedHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  if (expectedHex !== providedHex) return null
  return { conversationId: parts[0], visitorId: parts[1] }
}

/**
 * Rate limit check via rate_limits table.
 * Returns true if the request is allowed, false if limit exceeded.
 */
export async function checkRateLimit(
  appId: string,
  visitorId: string,
  limitPerMin: number
): Promise<boolean> {
  const db = serviceClient()
  const minuteBucket = Math.floor(Date.now() / 60000)

  const { data, error } = await db.rpc('increment_rate_limit', {
    p_app_id: appId,
    p_visitor_id: visitorId,
    p_minute_bucket: minuteBucket,
  })

  if (error) {
    // Fail open — don't block on rate limit errors
    console.error('rate_limit error:', error)
    return true
  }

  return (data as number) <= limitPerMin
}
