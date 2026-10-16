import { assert, assertEquals } from '@std/assert'
import { isOriginAllowed } from '../cors.ts'
import { Router } from '../http.ts'
import { looksLikeKey } from './keys.ts'
import { signSession, verifySession } from './session.ts'

const SECRET = 'x'.repeat(40)

Deno.test('widget sessions round-trip and reject tampering and expiry', async () => {
  const token = await signSession({ ws: 'w1', bot: 'b1', ct: 'c1' }, SECRET)
  const s = await verifySession(token, SECRET)
  assertEquals([s?.ws, s?.bot, s?.ct], ['w1', 'b1', 'c1'])

  const [body, sig] = token.split('.')
  const forged = btoa(JSON.stringify({ v: 1, ws: 'w2', bot: 'b1', ct: 'c1', exp: 9e9 })).replace(/=+$/, '')
  assertEquals(await verifySession(`${forged}.${sig}`, SECRET), null, 'payload swap')
  assertEquals(await verifySession(`${body}.${sig.slice(0, -2)}xx`, SECRET), null, 'bad signature')
  assertEquals(await verifySession(token, 'y'.repeat(40)), null, 'other secret')
  const old = await signSession({ ws: 'w', bot: 'b', ct: 'c', exp: Math.floor(Date.now() / 1000) - 1 }, SECRET)
  assertEquals(await verifySession(old, SECRET), null, 'expired')
  assertEquals(await verifySession('garbage', SECRET), null)
  assertEquals(await verifySession(null, SECRET), null)
})

Deno.test('API key formats', () => {
  assert(looksLikeKey('bd_pk_' + 'a'.repeat(32)))
  assert(looksLikeKey('bd_sk_' + 'A1'.repeat(16)))
  assert(looksLikeKey('bdk_live_' + 'ab12'.repeat(6)), 'v1 keys still work')
  assert(!looksLikeKey('bd_sk_short'))
  assert(!looksLikeKey('eyJhbGciOi...'))
})

Deno.test('allowed domains', () => {
  assert(isOriginAllowed('https://anything.com', []), 'empty list allows all')
  assert(isOriginAllowed('https://shop.com', ['shop.com']))
  assert(isOriginAllowed('https://www.shop.com', ['shop.com']))
  assert(!isOriginAllowed('https://evilshop.com', ['shop.com']))
  assert(!isOriginAllowed('https://shop.com.evil.io', ['shop.com']))
  assert(isOriginAllowed('https://a.shop.com', ['*.shop.com']))
  assert(!isOriginAllowed('https://shop.com', ['*.shop.com']))
  assert(isOriginAllowed('http://localhost:5173', ['http://localhost:5173']))
  assert(!isOriginAllowed('http://localhost:3000', ['http://localhost:5173']))
  assert(!isOriginAllowed(null, ['shop.com']), 'no origin needs "app"')
  assert(isOriginAllowed(null, ['shop.com', 'app']))
})

Deno.test('router matches paths, params and methods', () => {
  const r = new Router().on('GET', '/v1/conversations/:id/messages', () => new Response('ok'))
  const m = r.match('GET', '/v1/conversations/abc-1/messages')
  assert(m && m !== 'method')
  assertEquals((m as any).params, { id: 'abc-1' })
  assertEquals(r.match('POST', '/v1/conversations/abc/messages'), 'method')
  assertEquals(r.match('GET', '/v1/other'), null)
  assertEquals(Router.localPath(new URL('http://x/functions/v1/api/v1/chat'), 'api'), '/v1/chat')
  assertEquals(Router.localPath(new URL('http://x/api/v1/chat'), 'api'), '/v1/chat')
})
