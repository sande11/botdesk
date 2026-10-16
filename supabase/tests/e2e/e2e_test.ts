/**
 * End-to-end smoke test against a local stack with fake AI.
 *
 *   npx supabase start && npx supabase db reset
 *   npx supabase functions serve --env-file supabase/functions/.env   (BOTDESK_FAKE_AI=1)
 *   E2E=1 deno test -A --config supabase/functions/deno.json supabase/tests/e2e/
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, WORKER_SECRET,
 * FUNCTIONS_URL (default $SUPABASE_URL/functions/v1). Set API_URL, CHANNELS_URL,
 * WORKER_URL, ADMIN_URL to target functions served separately.
 */
import { assert, assertEquals, assertExists } from '@std/assert'
import { createClient } from '@supabase/supabase-js'

const E2E = Deno.env.get('E2E') === '1'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321'
const FN = Deno.env.get('FUNCTIONS_URL') ?? `${SUPABASE_URL}/functions/v1`
const API = Deno.env.get('API_URL') ?? `${FN}/api`
const CHANNELS = Deno.env.get('CHANNELS_URL') ?? `${FN}/channels`
const WORKER = Deno.env.get('WORKER_URL') ?? `${FN}/worker`
const ADMIN = Deno.env.get('ADMIN_URL') ?? `${FN}/admin`
const PUBLIC_API_URL = Deno.env.get('PUBLIC_API_URL') ?? FN

const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const service = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })

const EMPLOYMENT_ACT = `PART III — TERMINATION OF CONTRACTS

29. Notice of termination
(1) A contract of employment shall not be terminated by an employer unless the employer gives the employee written notice.
(2) The notice period is one month for employees paid monthly.

35. Severance allowance
On termination of contract by mutual agreement or by the employer, an employee is entitled to severance allowance.

42. Right to be heard
An employer shall not terminate an employee for reasons of conduct or performance before the employee is given an opportunity to defend himself against the allegations.`

async function runWorker() {
  const res = await fetch(`${WORKER}?wait=1`, { method: 'POST', headers: { 'x-worker-secret': Deno.env.get('WORKER_SECRET') ?? '' } })
  assertEquals(res.status, 200, await res.text())
}

async function api(path: string, init: RequestInit & { key?: string; session?: string; origin?: string } = {}) {
  const headers = new Headers(init.headers)
  if (init.key) headers.set('authorization', `Bearer ${init.key}`)
  if (init.session) headers.set('x-session', init.session)
  if (init.origin) headers.set('origin', init.origin)
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json')
  const res = await fetch(`${API}${path}`, { ...init, headers })
  const text = await res.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    // SSE or plain text
  }
  return { status: res.status, body, text }
}

Deno.test({
  name: 'BotDesk end to end (fake AI)',
  ignore: !E2E,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const email = `owner-${Date.now()}@example.com`
    const { error: signUpErr } = await service.auth.admin.createUser({ email, password: 'Password123!', email_confirm: true })
    assert(!signUpErr, signUpErr?.message)
    const user = createClient(SUPABASE_URL, anon, { auth: { persistSession: false } })
    const { data: session, error: loginErr } = await user.auth.signInWithPassword({ email, password: 'Password123!' })
    assert(!loginErr, loginErr?.message)
    const jwt = session.session!.access_token

    // Someone with their own account but no access to the workspace under test.
    const outsider = `outsider-${Date.now()}@example.com`
    await service.auth.admin.createUser({ email: outsider, password: 'Password123!', email_confirm: true })
    const outsiderClient = createClient(SUPABASE_URL, anon, { auth: { persistSession: false } })
    const { data: outsiderSession } = await outsiderClient.auth.signInWithPassword({ email: outsider, password: 'Password123!' })
    const otherJwt = outsiderSession.session!.access_token

    let ws = '', kb = '', bot = '', pk = '', sk = '', conv = '', answerId = ''

    await t.step('workspace, knowledge base, bot', async () => {
      const { data: wsId, error } = await user.rpc('create_workspace', { p_name: 'LegAI', p_template: 'legal' })
      assert(!error, error?.message)
      ws = wsId
      const k = await user.from('knowledge_bases').insert({
        workspace_id: ws, name: 'Laws of Malawi', embedding_provider: 'mock', embedding_model: 'mock-1024', legal: true,
      }).select('id').single()
      assert(!k.error, k.error?.message)
      kb = k.data!.id
      const b = await user.from('bots').insert({
        workspace_id: ws, name: 'LegAI Assistant',
        model: { provider: 'mock', model: 'mock-chat', max_tokens: 600 },
        legal: { enabled: true, default_jurisdiction: 'MW' },
        allowed_domains: ['localhost'],
      }).select('id').single()
      assert(!b.error, b.error?.message)
      bot = b.data!.id
      const l = await user.from('bot_knowledge_bases').insert({ bot_id: bot, knowledge_base_id: kb, workspace_id: ws })
      assert(!l.error, l.error?.message)
    })

    await t.step('a source is chunked and embedded by the worker', async () => {
      const s = await user.from('sources').insert({
        workspace_id: ws, knowledge_base_id: kb, kind: 'text', title: 'Employment Act', content: EMPLOYMENT_ACT,
        jurisdiction: 'MW', source_type: 'statute', citation: 'Employment Act (Cap. 55:01)',
      }).select('id').single()
      assert(!s.error, s.error?.message)
      await runWorker()
      const { data } = await user.from('sources').select('status, chunk_count, error').eq('id', s.data!.id).single()
      assertEquals(data?.status, 'ready', data?.error ?? '')
      assert(data!.chunk_count >= 3)
      const { count } = await service.from('chunks').select('id', { count: 'exact', head: true }).eq('source_id', s.data!.id).not('embedding', 'is', null)
      assertEquals(count, data!.chunk_count)
      const { data: sections } = await service.from('chunks').select('section').eq('source_id', s.data!.id).order('ordinal')
      assertEquals(sections!.map((r) => r.section), ['s. 29', 's. 35', 's. 42'])
    })

    await t.step('API keys', async () => {
      pk = (await user.rpc('create_api_key', { p_workspace: ws, p_name: 'Widget', p_kind: 'publishable', p_bot: bot })).data
      sk = (await user.rpc('create_api_key', { p_workspace: ws, p_name: 'LegAI app backend', p_kind: 'secret' })).data
      assert(pk.startsWith('bd_pk_') && sk.startsWith('bd_sk_'))
    })

    let widgetSession = ''
    await t.step('widget: session, allowed domains, streaming answer with citations', async () => {
      const denied = await api('/v1/widget/session', {
        method: 'POST', key: pk, origin: 'https://evil.example', body: JSON.stringify({ visitor_id: 'visitor-123456' }),
      })
      assertEquals(denied.status, 403)
      const ok = await api('/v1/widget/session', {
        method: 'POST', key: pk, origin: 'http://localhost:5173', body: JSON.stringify({ visitor_id: 'visitor-123456' }),
      })
      assertEquals(ok.status, 200, ok.text)
      widgetSession = ok.body.session
      assertEquals(ok.body.bot.title, 'Ask us anything')

      const s = await api('/v1/chat', {
        method: 'POST', key: pk, session: widgetSession, origin: 'http://localhost:5173',
        body: JSON.stringify({ message: 'How much notice must my employer give before terminating my contract?', stream: true }),
      })
      assertEquals(s.status, 200, s.text)
      assert(s.text.includes('event: start'))
      assert(s.text.includes('event: delta'))
      const done = JSON.parse(s.text.split('event: done\ndata: ')[1].split('\n')[0])
      assertEquals(done.answer.outcome, 'answered')
      assert(done.answer.citations.length >= 1)
      assertEquals(done.answer.citations[0].section, 's. 29')
      assert(done.answer.disclaimer, 'legal bots carry a disclaimer')
      conv = done.conversation_id
      answerId = done.message_id
    })

    await t.step('widget: unknown topics are declined with an offer of a person', async () => {
      const r = await api('/v1/chat', {
        method: 'POST', key: pk, session: widgetSession, origin: 'http://localhost:5173',
        body: JSON.stringify({ message: 'What is the best pizza topping?' }),
      })
      assertEquals(r.body.answer.outcome, 'no_answer')
      assert(r.body.answer.offer_handoff)
      assert(r.body.answer.text.includes('talk to a person'))
    })

    await t.step('feedback sends an answer to the review queue', async () => {
      const r = await api('/v1/feedback', {
        method: 'POST', key: pk, session: widgetSession, origin: 'http://localhost:5173',
        body: JSON.stringify({ message_id: answerId, rating: -1, comment: 'Unclear' }),
      })
      assertEquals(r.status, 200, r.text)
      const { data } = await user.from('review_items').select('reason').eq('message_id', answerId)
      assertEquals(data?.[0]?.reason, 'negative_feedback')
    })

    await t.step('hand-off: the bot stops, a person replies from the inbox, the widget sees it', async () => {
      const h = await api('/v1/handoff', {
        method: 'POST', key: pk, session: widgetSession, origin: 'http://localhost:5173',
        body: JSON.stringify({ conversation_id: conv, name: 'Chikondi', email: 'chikondi@example.com' }),
      })
      assertEquals(h.status, 200, h.text)
      const quiet = await api('/v1/chat', {
        method: 'POST', key: pk, session: widgetSession, origin: 'http://localhost:5173',
        body: JSON.stringify({ message: 'Hello?', conversation_id: conv }),
      })
      assertEquals(quiet.body.handoff, true)
      assertEquals(quiet.body.answer, null)
      const reply = await user.from('messages').insert({
        workspace_id: ws, conversation_id: conv, role: 'agent', content: 'Hi Chikondi, a lawyer here.', author_id: session.user!.id,
      })
      assert(!reply.error, reply.error?.message)
      const poll = await api(`/v1/conversations/${conv}/messages?session=${encodeURIComponent(widgetSession)}`, { origin: 'http://localhost:5173', key: pk })
      assertEquals(poll.status, 200, poll.text)
      assertEquals(poll.body.conversation.status, 'handoff')
      assert(poll.body.messages.some((m: any) => m.role === 'agent'))
      const { data: contact } = await user.from('conversations').select('contacts(name, email)').eq('id', conv).single()
      assertEquals((contact as any).contacts.email, 'chikondi@example.com')
    })

    await t.step('another visitor cannot read the conversation', async () => {
      const other = await api('/v1/widget/session', {
        method: 'POST', key: pk, origin: 'http://localhost:5173', body: JSON.stringify({ visitor_id: 'visitor-999999' }),
      })
      const r = await api(`/v1/conversations/${conv}/messages?session=${encodeURIComponent(other.body.session)}`, { origin: 'http://localhost:5173', key: pk })
      assertEquals(r.status, 404)
    })

    await t.step('server API (secret key): structured legal answer for the LegAI app', async () => {
      const fromBrowser = await api('/v1/chat', { method: 'POST', key: sk, origin: 'https://x.com', body: JSON.stringify({ message: 'hi', user: { id: 'u1' } }) })
      assertEquals(fromBrowser.status, 403, 'secret keys refuse browser calls')
      const r = await api('/v1/chat', {
        method: 'POST', key: sk,
        body: JSON.stringify({ message: 'Can my employer terminate me before I get an opportunity to defend myself against the allegations?', user: { id: 'app-user-1' }, format: 'legal', jurisdiction: 'MW', bot_id: bot }),
      })
      assertEquals(r.status, 200, r.text)
      const legal = r.body.answer.legal
      assertExists(legal, r.text)
      assert(legal.summary.length > 10, r.text)
      assert(legal.sources.length >= 1, r.text)
      assert(legal.sources[0].title.includes('Employment Act'), r.text)
      assertEquals(r.body.answer.jurisdiction, 'MW')

      // An app's own thread ids map one-to-one to BotDesk conversations.
      const ask = (ref: string) => api('/v1/chat', {
        method: 'POST', key: sk,
        body: JSON.stringify({ message: 'Is notice required?', user: { id: 'app-user-3' }, conversation_ref: ref, bot_id: bot }),
      })
      const a1 = await ask('thread-a'), b1 = await ask('thread-b'), a2 = await ask('thread-a')
      assertEquals(a1.status, 200, a1.text)
      assert(a1.body.conversation_id !== b1.body.conversation_id, 'different threads, different conversations')
      assertEquals(a2.body.conversation_id, a1.body.conversation_id, 'the same thread continues')
    })

    await t.step('Listen In: transcript analysis and summary', async () => {
      const r = await api('/v1/legal/analyze', {
        method: 'POST', key: sk,
        body: JSON.stringify({
          bot_id: bot,
          segment: { id: 's1', text: 'We think it is best you resign today and sign this letter now.', start_ms: 754000, speaker: 'Manager' },
          context: { topic: 'work', jurisdiction: 'MW', already_flagged: [] },
        }),
      })
      assertEquals(r.status, 200, r.text)
      assertEquals(r.body.flags[0].kind, 'caution')
      assertEquals(r.body.flags[0].at_ms, 754000)
      const s = await api('/v1/legal/summarize', {
        method: 'POST', key: sk,
        body: JSON.stringify({ bot_id: bot, segments: [{ text: 'Please resign today.' }], flags: [{ title: "You don't have to sign today." }] }),
      })
      assertEquals(s.status, 200, s.text)
      assert(typeof s.body.summary === 'string')
    })

    await t.step('feeding sources by API: text with external id, then a PDF upload', async () => {
      const a = await api('/v1/sources', {
        method: 'POST', key: sk,
        body: JSON.stringify({ knowledge_base_id: kb, kind: 'qa', question: 'How long is maternity leave?', answer: 'Eight weeks on full pay.', external_id: 'faq-1', jurisdiction: 'MW' }),
      })
      assertEquals(a.status, 201, a.text)
      const again = await api('/v1/sources', {
        method: 'POST', key: sk,
        body: JSON.stringify({ knowledge_base_id: kb, kind: 'qa', question: 'How long is maternity leave?', answer: 'Eight weeks on full pay, every three years.', external_id: 'faq-1' }),
      })
      assertEquals(again.body.updated, true)
      assertEquals(again.body.source.id, a.body.source.id)

      const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 74>>stream
BT /F1 12 Tf 20 100 Td (Tenants must get three months notice to vacate.) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`
      const form = new FormData()
      form.append('knowledge_base_id', kb)
      form.append('jurisdiction', 'MW')
      form.append('source_type', 'statute')
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'Landlord and Tenant Act.pdf')
      const up = await fetch(`${API}/v1/sources/upload`, { method: 'POST', headers: { authorization: `Bearer ${sk}` }, body: form })
      const upBody = await up.json()
      assertEquals(up.status, 201, JSON.stringify(upBody))
      await runWorker()
      const st = await api(`/v1/sources/${upBody.source.id}`, { key: sk })
      assertEquals(st.body.source.status, 'ready', JSON.stringify(st.body))
      const q = await api('/v1/chat', {
        method: 'POST', key: sk, body: JSON.stringify({ message: 'How much notice must tenants get to vacate?', user: { id: 'app-user-2' }, bot_id: bot }),
      })
      assertEquals(q.body.answer.outcome, 'answered', q.text)
      assert(q.body.answer.citations.some((c: any) => c.title === 'Landlord and Tenant Act'))
    })

    await t.step('dashboard: playground and model catalogue', async () => {
      const res = await fetch(`${ADMIN}/playground`, {
        method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ bot_id: bot, message: 'Is severance allowance payable?', jurisdiction: 'MW' }),
      })
      const body = await res.json()
      assertEquals(res.status, 200, JSON.stringify(body))
      assert(body.result.retrieval.length > 0)
      const m = await fetch(`${ADMIN}/models?workspace_id=${ws}`, { headers: { authorization: `Bearer ${jwt}` } })
      const mb = await m.json()
      assertEquals(mb.fake_ai, true)
      assert(mb.chat.length >= 3)

      // Knowledge test search returns ranked passages with both scores.
      const sr = await fetch(`${ADMIN}/search`, {
        method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ knowledge_base_id: kb, query: 'notice before termination' }),
      })
      const sb = await sr.json()
      assertEquals(sr.status, 200, JSON.stringify(sb))
      assert(sb.results.length > 0)
      assert('vector_score' in sb.results[0] && 'text_score' in sb.results[0])
      // ...and only for members of the knowledge base's workspace.
      const other = await fetch(`${ADMIN}/search`, {
        method: 'POST', headers: { authorization: `Bearer ${otherJwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ knowledge_base_id: kb, query: 'notice' }),
      })
      assertEquals(other.status, 403, await other.text())
    })

    await t.step('SMS: a signed Twilio webhook gets an answer (sending fails without real Twilio)', async () => {
      const res = await fetch(`${ADMIN}/channels`, {
        method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace_id: ws, bot_id: bot, kind: 'twilio_sms', name: 'SMS line',
          config: { account_sid: 'AC00000000000000000000000000000000', from_number: '+15550001111' },
          secrets: { auth_token: 'test-auth-token' },
        }),
      })
      const ch = await res.json()
      assertEquals(res.status, 201, JSON.stringify(ch))
      const token = ch.channel.webhook_url.split('/').pop()
      const params = { From: '+265991000111', To: '+15550001111', Body: 'Do I get notice before termination?', MessageSid: 'SM' + Date.now() }
      const { twilioSignature } = await import('../../functions/_shared/channels/providers.ts')
      const sig = await twilioSignature(`${PUBLIC_API_URL}/channels/twilio/${token}`, params, 'test-auth-token')
      const bad = await fetch(`${CHANNELS}/channels/twilio/${token}`, { method: 'POST', headers: { 'x-twilio-signature': 'nope' }, body: new URLSearchParams(params) })
      assertEquals(bad.status, 403)
      await bad.body?.cancel()
      const good = await fetch(`${CHANNELS}/channels/twilio/${token}`, { method: 'POST', headers: { 'x-twilio-signature': sig }, body: new URLSearchParams(params) })
      assertEquals(good.status, 200, await good.text())
      // The reply is saved first and sent in the background, so wait for the send to settle.
      let reply: any = null
      for (let i = 0; i < 60 && !(reply && reply.delivery_status && reply.delivery_status !== 'pending'); i++) {
        await new Promise((r) => setTimeout(r, 250))
        const { data } = await service.from('messages').select('content, delivery_status, conversation_id, conversations!inner(channel)')
          .eq('workspace_id', ws).eq('role', 'assistant').eq('conversations.channel', 'sms').limit(1)
        reply = data?.[0]
      }
      assertExists(reply, 'the bot answered the SMS')
      assert(reply.content.includes('Sources:'), reply.content)
      assertEquals(reply.delivery_status, 'failed', 'no real Twilio account in tests')
    })

    await t.step('training: corrected answers become a dataset; evals run', async () => {
      const { data: item } = await user.from('review_items').select('id').eq('message_id', answerId).single()
      await user.from('review_items').update({ status: 'corrected', corrected_answer: 'One month written notice (s. 29).', reviewer_id: session.user!.id, reviewed_at: new Date().toISOString() }).eq('id', item!.id)
      const ds = await user.from('datasets').insert({ workspace_id: ws, name: 'Employment' }).select('id').single()
      const { data: added } = await user.rpc('collect_examples', { p_dataset: ds.data!.id })
      assertEquals(added, 1)
      const exp = await fetch(`${ADMIN}/datasets/${ds.data!.id}/export`, { headers: { authorization: `Bearer ${jwt}` } })
      assertEquals(exp.headers.get('x-example-count'), '1')
      await exp.body?.cancel()

      const set = await user.from('eval_sets').insert({ workspace_id: ws, name: 'Basics' }).select('id').single()
      const cases = await user.from('eval_cases').insert([
        { workspace_id: ws, eval_set_id: set.data!.id, question: 'Is notice of termination required?', expected_answer: 'Yes, written notice of termination is required.', should_decline: false },
        { workspace_id: ws, eval_set_id: set.data!.id, question: 'Who won the football?', expected_answer: '', should_decline: true },
      ])
      assert(!cases.error, cases.error?.message)
      const run = await user.from('eval_runs').insert({ workspace_id: ws, eval_set_id: set.data!.id, bot_id: bot }).select('id').single()
      assert(!run.error, run.error?.message)
      await runWorker()
      const { data: done } = await user.from('eval_runs').select('status, metrics').eq('id', run.data!.id).single()
      assertEquals(done?.status, 'done', JSON.stringify(done))
      assertEquals(done?.metrics.cases, 2, JSON.stringify(done))
      assert(done?.metrics.answered_rate === 0.5, JSON.stringify(done?.metrics))
    })

    await t.step('usage is metered', async () => {
      await new Promise((r) => setTimeout(r, 500))
      const { data } = await user.from('usage_monthly').select('messages').eq('workspace_id', ws).single()
      assert(data!.messages >= 3, `messages: ${data?.messages}`)
    })
  },
})
