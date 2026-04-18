import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { copyToClipboard } from '../utils/helpers.js'
import { useAppsContext } from '../context/AppsContext.js'

// The widget CSS — paste this into your site or save as style.css
const WIDGET_CSS = `/* BotDesk Widget Styles */
#botdesk-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'DM Sans', system-ui, sans-serif; }

:root {
  --bd-accent:    #7c6df8;
  --bd-accent2:   #a99dfa;
  --bd-bg:        #13131a;
  --bd-bg2:       #1a1a24;
  --bd-bg3:       #22222f;
  --bd-border:    rgba(255,255,255,0.12);
  --bd-text:      #f0eff5;
  --bd-text2:     #9998a8;
  --bd-text3:     #5c5b70;
  --bd-green:     #34d399;
  --bd-amber:     #fbbf24;
  --bd-amber-bg:  rgba(251,191,36,0.1);
  --bd-shadow:    0 4px 24px rgba(0,0,0,0.5);
}

#botdesk-root ::-webkit-scrollbar       { width: 3px; }
#botdesk-root ::-webkit-scrollbar-track { background: transparent; }
#botdesk-root ::-webkit-scrollbar-thumb { background: var(--bd-border); border-radius: 3px; }

@keyframes bd-bounce  { 0%,60%,100%{ transform:translateY(0) } 30%{ transform:translateY(-5px) } }
@keyframes bd-slideUp { from { opacity:0; transform: scale(0.9) translateY(12px); } to { opacity:1; transform: scale(1) translateY(0); } }
@keyframes bd-fadeIn  { from { opacity:0 } to { opacity:1 } }`

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
  const apiKey = app?.apiKey         ?? 'YOUR_API_KEY_HERE'
  const color  = app?.primaryColor   ?? '#7c6df8'
  const name   = app?.botName        ?? 'AI Assistant'
  const msg    = app?.welcomeMessage ?? 'Hi! How can I help you today?'
  const pos    = app?.position       ?? 'bottom-right'

  return `<!-- BotDesk Chat Widget — ${app?.name ?? 'Your App'} -->
<link rel="stylesheet" href="./style.css" />
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

  const CopyBtn = ({ id, text }) => (
    <button
      onClick={() => copy(id, text)}
      style={{
        position: 'absolute', top: 10, right: 10,
        background: 'var(--bg3)', border: '1px solid var(--border2)',
        color: 'var(--text)', padding: '4px 10px', borderRadius: 6,
        fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.15s',
      }}
    >
      {copied === id ? '✓ Copied' : 'Copy'}
    </button>
  )

  const CodeBlock = ({ id, code }) => (
    <div className="code-block" style={{ position: 'relative' }}>
      <CopyBtn id={id} text={code} />
      {code}
    </div>
  )

  return (
    <div className="animate-fade-in" style={{ overflowX: 'hidden' }}>
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

      {/* API key notices */}
      {selectedApp && !selectedApp.apiKey && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 14, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: '#fbbf24' }}>
          <span>⚠</span>
          <span style={{ flex: 1 }}>
            The API key for <strong>{selectedApp.name}</strong> is only shown once at creation.
            Go to <a href="/settings" style={{ color: '#fbbf24', fontWeight: 600 }}>Settings → API Keys</a> and rotate it — the new key will appear in the snippets below automatically.
          </span>
        </div>
      )}
      {selectedApp && selectedApp.apiKey && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 14, background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--accent2)' }}>
          <span>🔑</span>
          <span>Snippets below use the live API key for <strong>{selectedApp.name}</strong>. Each app has its own key — never share keys between sites.</span>
        </div>
      )}

      {/* ── Step-by-step setup ──────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>🚀 How to integrate — 3 steps</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            {
              n: '1',
              title: 'Add the two widget files to your site',
              body: 'Your site needs two files: widget.iife.js (the chat bundle) and style.css (the widget styles). Copy both files from the "Integration files" section below into your website\'s root folder, or upload them to your CDN / static host.',
            },
            {
              n: '2',
              title: 'Add the embed snippet before </body>',
              body: 'Copy the embed snippet below and paste it at the bottom of your HTML, just before the closing </body> tag. Replace YOUR_API_KEY_HERE with your app\'s API key. The snippet loads the widget bundle and passes your config.',
            },
            {
              n: '3',
              title: 'Open your site — the chat bubble appears',
              body: 'The widget initialises automatically. The bubble appears bottom-right (or your chosen position). Test it by asking a question — if your Knowledge Base has matching entries, the bot will answer. Out-of-scope questions trigger the escalation form.',
            },
          ].map((step, i, arr) => (
            <div key={step.n} style={{ display: 'flex', gap: 16, paddingBottom: i < arr.length - 1 ? 20 : 0, marginBottom: i < arr.length - 1 ? 20 : 0, borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white', flexShrink: 0, marginTop: 1 }}>{step.n}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>{step.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.65 }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Integration files ───────────────────────────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>
          Integration files — copy these into your website folder
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* style.css */}
          <div className="card" style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>style.css</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Widget styles · ~900 B · save as <code>style.css</code></div>
              </div>
              <span style={{ fontSize: 10, padding: '3px 8px', background: 'rgba(52,211,153,0.12)', color: 'var(--green)', borderRadius: 20, fontWeight: 600 }}>CSS</span>
            </div>
            <div className="code-block" style={{ position: 'relative', fontSize: 11, maxHeight: 180, overflowY: 'auto', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              <CopyBtn id="css-file" text={WIDGET_CSS} />
              {WIDGET_CSS}
            </div>
          </div>

          {/* widget.iife.js */}
          <div className="card" style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>widget.iife.js</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Chat bundle · ~682 KB · save as <code>widget.iife.js</code></div>
              </div>
              <span style={{ fontSize: 10, padding: '3px 8px', background: 'rgba(124,109,248,0.15)', color: 'var(--accent)', borderRadius: 20, fontWeight: 600 }}>JS</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: '12px 14px', background: 'var(--bg3)', borderRadius: 8, fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>
                The widget bundle is too large to display inline. Build it from the BotDesk source and copy the output file to your site.
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 500, marginBottom: 2 }}>Build command (run in the BotDesk project folder):</div>
              <div className="code-block" style={{ position: 'relative', fontSize: 12 }}>
                <CopyBtn id="build-cmd" text="npm run build:widget" />
                npm run build:widget
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
                Output: <code style={{ color: 'var(--text2)' }}>dist-widget/widget.iife.js</code><br />
                Copy both <code style={{ color: 'var(--text2)' }}>widget.iife.js</code> and <code style={{ color: 'var(--text2)' }}>style.css</code> from that folder into your website.
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Embed snippets ──────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Embed snippets — paste before &lt;/body&gt;
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div className="card" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>🔧 Universal HTML snippet</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 12 }}>
            Works on any HTML site — WordPress, Webflow, plain HTML, etc.
          </div>
          <CodeBlock id="script" code={scriptSnippet} />
        </div>

        <div className="card" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>🖼 Framer integration</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 12 }}>
            Paste via Framer → Site Settings → Custom Code → End of &lt;body&gt;
          </div>
          <CodeBlock id="framer" code={FRAMER_STEPS} />
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--amber-bg)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--amber)', lineHeight: 1.5 }}>
            ⚠ This API key is tied to <strong>{selectedApp?.name ?? 'this app'}</strong> only. Using it on a different domain will fail CORS validation.
          </div>
        </div>
      </div>

      {/* React / Next.js */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>⚛ React / Next.js component</div>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 12 }}>
          Import directly into your React or Next.js layout — no separate files needed
        </div>
        <CodeBlock id="react" code={reactSnippet} />
      </div>

      {/* Security notes */}
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>🔒 Security &amp; privacy</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
          {/* minWidth:0 on each card prevents grid blowout from long text */}
          {[
            ['🔑 Per-app API key authentication', 'Every widget request is authenticated with a key scoped to its app and domain. Keys can be rotated at any time from Settings → API Keys.'],
            ['🌐 CORS origin whitelisting',        'The widget only loads on domains you whitelist per app in Settings. Leave the field empty during development to allow all origins.'],
            ['🛡 Per-visitor rate limiting',        'Each visitor is limited to 15 messages/minute server-side. Requests exceeding the limit receive a graceful error without exposing backend details.'],
            ['🔐 Encrypted in transit',             'All messages travel over TLS 1.3. Conversation data is stored in a region-isolated Supabase PostgreSQL database with row-level security.'],
            ['🧹 XSS & injection defence',          'All user input is sanitised before storage and rendering. The widget runs in its own scoped DOM subtree to avoid conflicts with your site styles.'],
            ['🗑 GDPR data deletion',               'Visitors can request data deletion at any time. The dashboard includes a one-click action that soft-deletes all messages and PII for a visitor.'],
          ].map(([title, desc]) => (
            <div key={title} style={{ minWidth: 0, padding: '14px 16px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
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
