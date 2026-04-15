import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { copyToClipboard } from '../utils/helpers.js'
import { useAppsContext } from '../context/AppsContext.js'

const FRAMER_STEPS = `Step-by-step: Framer integration
──────────────────────────────────
1. Open your Framer project in the editor.
2. Click the gear icon (Site Settings) — top left.
3. Navigate to General → Custom Code.
4. Paste the embed script into the
   "End of <body> tag" section.
5. Click Save, then Publish your site.
6. The chat bubble will appear on every page.

⚠  The API key in the snippet above is specific
   to this app. Do not share it between sites.`

function buildScriptSnippet(app) {
  const apiKey = app?.apiKey  ?? 'YOUR_API_KEY_HERE'
  const color  = app?.primaryColor  ?? '#7c6df8'
  const name   = app?.botName       ?? 'AI Assistant'
  const msg    = app?.welcomeMessage ?? 'Hi! How can I help you today?'
  const pos    = app?.position       ?? 'bottom-right'

  return `<!-- BotDesk Chat Widget — ${app?.name ?? 'Your App'} -->
<script>
  window.BotDeskConfig = {
    apiKey:         '${apiKey}',
    primaryColor:   '${color}',
    botName:        '${name}',
    welcomeMessage: '${msg}',
    position:       '${pos}'
  };
  (function () {
    var s = document.createElement('script');
    s.src   = 'https://YOUR_DOMAIN.vercel.app/widget.iife.js';
    s.async = true;
    document.body.appendChild(s);
  })();
</script>`
}

function buildReactSnippet(app) {
  const apiKey = app?.apiKey        ?? 'YOUR_API_KEY_HERE'
  const color  = app?.primaryColor  ?? '#7c6df8'
  const msg    = app?.welcomeMessage ?? 'Hi! How can I help you today?'

  return `// Install inside your React / Next.js project:
// npm install @botdesk/widget

import { BotDeskWidget } from '@botdesk/widget'

export default function Layout({ children }) {
  return (
    <>
      {children}
      <BotDeskWidget
        apiKey="${apiKey}"
        primaryColor="${color}"
        welcomeMessage="${msg}"
      />
    </>
  )
}`
}

export default function Embed() {
  const navigate = useNavigate()
  const { apps, selectedAppId, selectedApp, setSelectedAppId } = useAppsContext()
  const [copied, setCopied] = useState('')

  const copy = async (id, text) => {
    const ok = await copyToClipboard(text)
    if (ok) { setCopied(id); setTimeout(() => setCopied(''), 2000) }
  }

  const scriptSnippet = buildScriptSnippet(selectedApp)
  const reactSnippet  = buildReactSnippet(selectedApp)

  const CodeBlock = ({ id, code }) => (
    <div className="code-block" style={{ position: 'relative' }}>
      <button
        onClick={() => copy(id, code)}
        style={{
          position: 'absolute', top: 10, right: 10,
          background: 'var(--bg3)', border: '1px solid var(--border2)',
          color: 'var(--text)', padding: '4px 10px', borderRadius: 6,
          fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.15s',
        }}
      >
        {copied === id ? '✓ Copied' : 'Copy'}
      </button>
      {code}
    </div>
  )

  return (
    <div className="animate-fade-in">
      <div className="page-title">Embed &amp; Deploy</div>
      <div className="page-sub">Add the chat widget to any website in minutes</div>

      {/* App selector */}
      {apps.length > 0 ? (
        <div className="card" style={{ marginBottom: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>App</span>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', flex: 1 }}>
            {apps.map((app) => {
              const active = selectedAppId === app.id
              return (
                <button
                  key={app.id}
                  onClick={() => setSelectedAppId(app.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 12px', borderRadius: 20,
                    border: `1.5px solid ${active ? app.primaryColor : 'var(--border2)'}`,
                    background: active ? app.primaryColor + '1a' : 'transparent',
                    color: active ? app.primaryColor : 'var(--text2)',
                    fontSize: 12.5, fontWeight: active ? 600 : 400,
                    cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.15s',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: app.primaryColor, flexShrink: 0 }} />
                  {app.name}
                </button>
              )
            })}
          </div>
          {selectedApp && (
            <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{selectedApp.url || 'No URL'}</span>
          )}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>No apps yet</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Create an app first to get a unique API key for its embed snippet.</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/apps')}>Create app</button>
        </div>
      )}

      {/* API key notice */}
      {selectedApp && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 14, background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--accent2)' }}>
          <span>🔑</span>
          <span>The snippets below use the API key for <strong>{selectedApp.name}</strong>. Each app has a unique key — do not share keys between sites.</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        {/* Script snippet */}
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>🔧 Universal embed script</div>
          <div style={{ fontSize: 12.5, color: 'var(--text)', marginBottom: 12 }}>
            Paste into the <code>&lt;body&gt;</code> of any HTML site
          </div>
          <CodeBlock id="script" code={scriptSnippet} />
        </div>

        {/* Framer */}
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>🖼 Framer integration</div>
          <div style={{ fontSize: 12.5, color: 'var(--text)', marginBottom: 12 }}>
            Paste the script via Framer&apos;s Custom Code panel
          </div>
          <CodeBlock id="framer" code={FRAMER_STEPS} />
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--amber-bg)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--amber)', lineHeight: 1.5 }}>
            ⚠ The API key above is tied to <strong>{selectedApp?.name ?? 'this app'}</strong> only. Using it on another site will fail CORS validation.
          </div>
        </div>
      </div>

      {/* React / Next.js */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>⚛ React / Next.js component</div>
        <div style={{ fontSize: 12.5, color: 'var(--text)', marginBottom: 12 }}>
          Install the npm package and drop the component into your layout
        </div>
        <CodeBlock id="react" code={reactSnippet} />
      </div>

      {/* Security notes */}
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>🔒 Security &amp; privacy</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
          {[
            ['🔑 Per-app API key authentication', 'Every widget request is authenticated with a key scoped to its app and domain. Keys are rotated automatically every 90 days.'],
            ['🌐 CORS origin whitelisting',        'The widget only loads on domains you whitelist per app. Requests from unknown origins are rejected at the CDN edge before reaching your API.'],
            ['🛡 Per-visitor rate limiting',        'Each visitor is limited to 15 messages/minute and 200 messages/day. Requests exceeding the limit receive a graceful error without exposing backend details.'],
            ['🔐 End-to-end encryption',            'All messages are encrypted in transit using TLS 1.3 and at rest using AES-256. No conversation data is stored in plaintext.'],
            ['🧹 XSS & injection defence',          'All user input is HTML-sanitised before storage and rendering. Content-Security-Policy headers restrict script execution to your own domain only.'],
            ['🗑 GDPR data deletion',               'Visitors can request data deletion at any time. Your dashboard includes a one-click "Delete visitor data" action that purges all messages and PII.'],
          ].map(([title, desc]) => (
            <div key={title} style={{ padding: '14px 16px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--green)' }}>✓</span> {title}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
