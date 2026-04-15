/**
 * Security Utilities
 * Centralized security helpers used across the app and widget.
 */

/**
 * HTML-encode dangerous characters to prevent XSS.
 * Always call this before rendering any user-supplied string.
 */
export function sanitize(str) {
  if (str === null || str === undefined) return ''
  return String(str).replace(/[<>&"'`]/g, (c) => ({
    '<':  '&lt;',
    '>':  '&gt;',
    '&':  '&amp;',
    '"':  '&quot;',
    "'":  '&#39;',
    '`':  '&#96;',
  }[c]))
}

/**
 * Validate an email address format.
 */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())
}

/**
 * Validate a phone / WhatsApp number (digits, spaces, +, -, parentheses only).
 */
export function isValidPhone(phone) {
  return /^[\d\s\+\-\(\)]{7,20}$/.test(String(phone).trim())
}

/**
 * Strip any HTML tags from a string entirely (for plain-text contexts).
 */
export function stripHtml(str) {
  return String(str).replace(/<[^>]*>/g, '')
}

/**
 * Per-session sliding-window rate limiter.
 * Creates an independent limiter instance — call createRateLimiter() once per widget/session.
 *
 * @param {number} maxPerWindow  - max calls allowed in the window
 * @param {number} windowMs      - window duration in milliseconds
 * @returns {{ check: () => boolean, reset: () => void }}
 */
export function createRateLimiter(maxPerWindow = 15, windowMs = 60_000) {
  let count = 0
  let windowStart = Date.now()

  return {
    check() {
      const now = Date.now()
      if (now - windowStart > windowMs) {
        count = 0
        windowStart = now
      }
      if (count >= maxPerWindow) return false
      count++
      return true
    },
    reset() {
      count = 0
      windowStart = Date.now()
    },
  }
}

/**
 * Content-Security-Policy nonce generator (for server-side usage reference).
 * In a real backend, generate a cryptographically random nonce per request.
 */
export function generateNonce() {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return btoa(String.fromCharCode(...arr))
}

/**
 * Truncate a string to maxLen characters, appending "…" if trimmed.
 */
export function truncate(str, maxLen = 500) {
  const s = String(str)
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
}
