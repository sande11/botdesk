/** Hashing, HMAC and token helpers (Web Crypto). */

const enc = new TextEncoder()

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  return toBase64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? enc.encode(input) : input
  return toHex(await crypto.subtle.digest('SHA-256', data as BufferSource))
}

async function hmac(
  hash: 'SHA-256' | 'SHA-1',
  secret: string,
  message: string | Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash }, false, ['sign'])
  const data = typeof message === 'string' ? enc.encode(message) : message
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as BufferSource))
}

export const hmacSha256 = (secret: string, message: string | Uint8Array) => hmac('SHA-256', secret, message)
export const hmacSha1 = (secret: string, message: string | Uint8Array) => hmac('SHA-1', secret, message)

/** Compares two strings in time that does not depend on where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  let diff = ab.length ^ bb.length
  const n = Math.max(ab.length, bb.length)
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

export function randomToken(bytes = 24): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return toBase64Url(b)
}
