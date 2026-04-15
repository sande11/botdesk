import { useState } from 'react'
import { sanitize, isValidEmail, isValidPhone } from '../utils/security.js'

const DEFAULT = {
  botName:          'AI Assistant',
  primaryColor:     '#7c6df8',
  greeting:         'Hi there 👋 How can I help you today?',
  outOfScopeMsg:    "I don't have that information yet. Let me connect you with our team!",
  escalationEmail:  'support@yourcompany.com',
  escalationPhone:  '+1 555 000 0000',
  rateLimitPerMin:  15,
  rateLimitPerDay:  200,
  allowedDomains:   'yoursite.com, app.yoursite.com',
  apiKey:           'sk_live_••••••••••••••••••••••••',
  widgetPosition:   'bottom-right',
  language:         'auto',
}

export default function Settings() {
  const [settings,  setSettings]  = useState(DEFAULT)
  const [saved,     setSaved]     = useState(false)
  const [errors,    setErrors]    = useState({})
  const [showKey,   setShowKey]   = useState(false)
  const [activeTab, setActiveTab] = useState('bot')

  const set = (key, val) => setSettings((p) => ({ ...p, [key]: sanitize(String(val)) }))

  const validate = () => {
    const e = {}
    if (!settings.botName.trim())        e.botName        = 'Bot name is required.'
    if (!settings.greeting.trim())       e.greeting       = 'Greeting is required.'
    if (settings.escalationEmail && !isValidEmail(settings.escalationEmail)) e.escalationEmail = 'Enter a valid email.'
    if (settings.escalationPhone && !isValidPhone(settings.escalationPhone)) e.escalationPhone = 'Enter a valid phone number.'
    const rpm = parseInt(settings.rateLimitPerMin)
    const rpd = parseInt(settings.rateLimitPerDay)
    if (isNaN(rpm) || rpm < 1 || rpm > 60)   e.rateLimitPerMin = 'Must be 1–60.'
    if (isNaN(rpd) || rpd < 10 || rpd > 500) e.rateLimitPerDay = 'Must be 10–500.'
    return e
  }

  const save = () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setErrors({})
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const Field = ({ label, field, type = 'text', placeholder, hint }) => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {type === 'textarea' ? (
        <textarea
          className="form-input"
          value={settings[field]}
          placeholder={placeholder}
          onChange={(e) => set(field, e.target.value)}
          maxLength={300}
          style={{ minHeight: 70, resize: 'vertical' }}
        />
      ) : (
        <input
          type={type}
          className="form-input"
          value={settings[field]}
          placeholder={placeholder}
          onChange={(e) => set(field, e.target.value)}
          maxLength={200}
        />
      )}
      {errors[field] && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{errors[field]}</div>}
      {hint && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{hint}</div>}
    </div>
  )

  const TABS = [
    { id: 'bot',      label: '🤖 Bot' },
    { id: 'escalate', label: '📨 Escalation' },
    { id: 'security', label: '🔒 Security' },
    { id: 'api',      label: '🔑 API Keys' },
  ]

  return (
    <div className="animate-fade-in">
      <div className="page-title">Settings</div>
      <div className="page-sub">Configure your chatbot behaviour, escalation, and security</div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 16px', background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)',
              color: activeTab === t.id ? 'var(--accent2)' : 'var(--text2)',
              borderBottom: `2px solid ${activeTab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1, transition: 'color 0.15s',
              fontWeight: activeTab === t.id ? 500 : 400,
            }}
          >{t.label}</button>
        ))}
      </div>

      {activeTab === 'bot' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Widget appearance</div>
            <Field label="Bot display name" field="botName" placeholder="AI Assistant" />
            <div className="form-group">
              <label className="form-label">Accent colour</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="color" value={settings.primaryColor} onChange={(e) => set('primaryColor', e.target.value)}
                  style={{ width: 40, height: 36, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 2 }} />
                <input className="form-input" value={settings.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} maxLength={7} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Widget position</label>
              <select className="form-input" value={settings.widgetPosition} onChange={(e) => set('widgetPosition', e.target.value)}>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Language</label>
              <select className="form-input" value={settings.language} onChange={(e) => set('language', e.target.value)}>
                <option value="auto">Auto-detect (recommended)</option>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="ar">Arabic</option>
                <option value="pt">Portuguese</option>
              </select>
            </div>
          </div>
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Bot messages</div>
            <Field label="Greeting message" field="greeting" type="textarea" placeholder="Hi there 👋 How can I help?" />
            <Field label="Out-of-scope response" field="outOfScopeMsg" type="textarea" placeholder="I'll connect you with our team…" hint="Shown when no knowledge base answer is found" />
          </div>
        </div>
      )}

      {activeTab === 'escalate' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Escalation channels</div>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.5 }}>
            When the bot can't answer, visitors are offered a way to reach your team. Configure where notifications are sent.
          </p>
          <Field label="Escalation email" field="escalationEmail" type="email" placeholder="support@yourcompany.com" hint="New escalations are forwarded here as email notifications" />
          <Field label="WhatsApp / phone number" field="escalationPhone" type="tel" placeholder="+1 555 000 0000" hint="Used to notify your team via WhatsApp Business API" />
          <div className="form-group">
            <label className="form-label">Rate limits</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label" style={{ marginBottom: 3 }}>Max msgs / min</label>
                <input type="number" className="form-input" value={settings.rateLimitPerMin} min={1} max={60}
                  onChange={(e) => set('rateLimitPerMin', e.target.value)} />
                {errors.rateLimitPerMin && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{errors.rateLimitPerMin}</div>}
              </div>
              <div>
                <label className="form-label" style={{ marginBottom: 3 }}>Max msgs / day</label>
                <input type="number" className="form-input" value={settings.rateLimitPerDay} min={10} max={500}
                  onChange={(e) => set('rateLimitPerDay', e.target.value)} />
                {errors.rateLimitPerDay && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{errors.rateLimitPerDay}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Domain whitelist &amp; CORS</div>
          <Field
            label="Allowed domains (comma-separated)"
            field="allowedDomains"
            type="textarea"
            placeholder="yoursite.com, app.yoursite.com"
            hint="The widget will only load on these domains. Requests from other origins are blocked."
          />
          <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--green-bg)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 8 }}>
            {[
              'TLS 1.3 in transit, AES-256 at rest',
              'XSS sanitisation on all user input',
              'CSP headers restrict script execution',
              'API keys auto-rotate every 90 days',
              'GDPR-compliant data deletion on request',
            ].map((line) => (
              <div key={line} style={{ fontSize: 12.5, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span>✓</span> {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'api' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>API Keys</div>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.5 }}>
            Your API key authenticates the embedded widget and any direct API calls. Never expose it publicly — use environment variables on your server.
          </p>
          <div className="form-group">
            <label className="form-label">Live API key</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                readOnly
                style={{ flex: 1, cursor: 'default', fontFamily: 'monospace' }}
              />
              <button className="btn btn-ghost btn-sm" onClick={() => setShowKey((s) => !s)}>{showKey ? 'Hide' : 'Show'}</button>
              <button className="btn btn-ghost btn-sm">Copy</button>
            </div>
          </div>
          <div style={{ padding: '10px 14px', background: 'var(--amber-bg)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--amber)', marginBottom: 16, lineHeight: 1.5 }}>
            ⚠ Regenerating your key will immediately invalidate the old key and break any live embeds until you update the config.
          </div>
          <button className="btn btn-danger btn-sm">Regenerate key</button>
        </div>
      )}

      {/* Save bar */}
      <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={save}>{saved ? '✓ Saved!' : 'Save settings'}</button>
        <button className="btn btn-ghost" onClick={() => setSettings(DEFAULT)}>Reset to defaults</button>
      </div>
    </div>
  )
}
