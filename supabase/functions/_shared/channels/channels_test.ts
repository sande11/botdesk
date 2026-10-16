import { assert, assertEquals } from '@std/assert'
import { hmacSha256, toHex } from '../crypto.ts'
import { formatForChannel, markdownToPlain, markdownToWhatsApp, wantsHuman } from './format.ts'
import {
  africasTalkingParse,
  twilioParse,
  twilioSignature,
  twilioSignatureOk,
  whatsappParse,
  whatsappSignatureOk,
  whatsappVerify,
} from './providers.ts'

Deno.test('WhatsApp GET verification', () => {
  const ok = new URL('https://x/c?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=123')
  assertEquals(whatsappVerify(ok, 'abc'), '123')
  assertEquals(whatsappVerify(ok, 'nope'), null)
})

Deno.test('WhatsApp signature check', async () => {
  const body = '{"entry":[]}'
  const sig = 'sha256=' + toHex(await hmacSha256('app-secret', body))
  assert(await whatsappSignatureOk(body, sig, 'app-secret'))
  assert(!(await whatsappSignatureOk(body + ' ', sig, 'app-secret')))
  assert(!(await whatsappSignatureOk(body, null, 'app-secret')))
})

Deno.test('WhatsApp payload parsing', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'PN1' },
          contacts: [{ wa_id: '265991', profile: { name: 'Chikondi' } }],
          messages: [
            { from: '265991', id: 'wamid.A', type: 'text', text: { body: 'Hello' } },
            { from: '265991', id: 'wamid.B', type: 'image', image: {} },
          ],
        },
      }],
    }],
  }
  const msgs = whatsappParse(payload, 'PN1')
  assertEquals(msgs[0], { from: '265991', messageId: 'wamid.A', name: 'Chikondi', text: 'Hello' })
  assertEquals(msgs[1].unsupported, 'image')
  assertEquals(whatsappParse(payload, 'OTHER'), [], 'messages for another number are ignored')
  assertEquals(whatsappParse({ entry: [{ changes: [{ field: 'messages', value: { statuses: [] } }] }] }, 'PN1'), [])
})

Deno.test('Twilio signature (worked example from Twilio\'s security docs)', async () => {
  const url = 'https://example.com/myapp.php?foo=1&bar=2'
  const params = { Digits: '1234', To: '+18005551212', From: '+14158675310', Caller: '+14158675310', CallSid: 'CA1234567890ABCDE' }
  assertEquals(await twilioSignature(url, params, '12345'), 'L/OH5YylLD5NRKLltdqwSvS0BnU=')
  assert(await twilioSignatureOk(url, params, 'L/OH5YylLD5NRKLltdqwSvS0BnU=', '12345'))
  assert(!(await twilioSignatureOk(url, params, 'bad', '12345')))
  assertEquals(twilioParse({ From: '+1', Body: 'hi', MessageSid: 'SM1' })?.text, 'hi')
  assertEquals(twilioParse({ Body: 'x' }), null)
})

Deno.test("Africa's Talking callback", () => {
  assertEquals(africasTalkingParse({ from: '+265888', to: '12345', text: 'Hi', id: 'ATX1', linkId: 'L' }), {
    from: '+265888', text: 'Hi', messageId: 'ATX1',
  })
  assertEquals(africasTalkingParse({ text: 'x' }), null)
})

Deno.test('formatting for SMS and WhatsApp', () => {
  const cites = [{ n: 1, title: 'Employment Act', citation: null, section: 's. 29' } as any]
  const sms = formatForChannel('**No.** You get notice [1].\n\n- In writing', cites, 'sms', { disclaimer: 'Not advice.' })
  assertEquals(sms, 'No. You get notice.\n\n- In writing\n\nSources: Employment Act · s. 29\n\nNot advice.')
  const wa = formatForChannel('## Notice\n**No.** See [the Act](https://x.mw) [1].', cites, 'whatsapp')
  assertEquals(wa, '*Notice*\n*No.* See the Act: https://x.mw.\n\n_Sources: Employment Act · s. 29_')
  assertEquals(markdownToPlain('*a* and *b*'), 'a and b')
  assertEquals(markdownToWhatsApp('- one'), '• one')
  assert(formatForChannel('x'.repeat(3000), [], 'sms').length <= 1200)
})

Deno.test('asking for a person', () => {
  for (const t of ['HUMAN', 'agent.', 'talk to a person', 'Speak to someone']) assert(wantsHuman(t), t)
  for (const t of ['I am human', 'what does an agent do?']) assert(!wantsHuman(t), t)
})
