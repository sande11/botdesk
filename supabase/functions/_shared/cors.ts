/**
 * Per-app CORS enforcement.
 * For widget endpoints: Origin must be in app_settings.allowed_domains (or wildcard '*').
 * For dashboard endpoints: any origin is fine (JWT auth handles security).
 */

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    'Access-Control-Max-Age': '86400',
  }
}

export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('origin')
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  return null
}

/**
 * Check if the request origin is allowed for this app.
 * allowed_domains = [] means allow all (useful during dev / not-yet-configured apps).
 */
export function isOriginAllowed(origin: string | null, allowedDomains: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true
  if (!origin) return false
  return allowedDomains.some((domain) => {
    if (domain === '*') return true
    try {
      const url = new URL(origin)
      return url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    } catch {
      return false
    }
  })
}
