/**
 * Which pages may use a bot through the widget (publishable key).
 *
 * allowed_domains entries:
 *   "example.com"     example.com and any subdomain
 *   "*.example.com"   subdomains only
 *   "http://localhost:5173"   an exact origin (handy in development)
 *   "app"             requests with no Origin header (native mobile apps)
 * An empty list allows every site; the dashboard warns about it.
 */
export function isOriginAllowed(origin: string | null, allowed: string[] | null | undefined): boolean {
  const list = (allowed ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean)
  if (!list.length) return true
  if (!origin || origin === 'null') return list.includes('app')
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  return list.some((entry) => {
    if (entry === 'app') return false
    if (entry === '*') return true
    if (entry.includes('://')) {
      try {
        return new URL(entry).origin === url.origin
      } catch {
        return false
      }
    }
    const domain = entry.replace(/^\*\./, '').replace(/\/.*$/, '')
    if (entry.startsWith('*.')) return host.endsWith(`.${domain}`)
    return host === domain || host.endsWith(`.${domain}`)
  })
}
