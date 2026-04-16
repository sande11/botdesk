import { useState, useEffect } from 'react'
import { sanitize, isValidEmail, isValidPhone } from '../utils/security.js'
import { useAppsContext } from '../context/AppsContext.js'

function Field({ label, field, type = 'text', placeholder, hint, settings, set, errors }) {
  return (
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
}

const TABS = [
  { id: 'bot',      label: '🤖 Bot' },
  { id: 'escalate', label: '📨 Escalation' },
  { id: 'security', label: '🔒 Security' },
  { id: 'api',      label: '🔑 API Keys' },
]

export default function Settings() {
  const {
    apps, selectedAppId, selectedApp,
    updateApp, updateSettings, createApiKey, revokeApiKey,
  } = useAppsContext()

  const [form,      setForm]      = useState(null)
  const [errors,    setErrors]    = useState({})
  const [saved,     setSaved]     = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [activeTab, setActiveTab] = useState('bot')

  // API key state
  const [newKey,    setNewKey]    = useState(null)   // raw key shown once after rotation
  const [rotating,  setRotating]  = useState(false)

  // Sync form from selectedApp whenever the selected app changes
  useEffect(() => {
    if (!selectedApp) return
    setForm({
      botName:         selectedApp.botName         ?? 'AI Assistant',
      primaryColor:    selectedApp.primaryColor     ?? '#7c6df8',
      greeting:        selectedApp.welcomeMessage   ?? '',
      widgetPosition:  selectedApp.position         ?? 'bottom-right',
      outOfScopeMsg:   selectedApp.settings?.outOfScopeMsg   ?? "I don't have that information yet. Let me connect you with our team!",
      escalationEmail: selectedApp.settings?.escalationEmail ?? '',
      escalationPhone: selectedApp.settings?.escalationPhone ?? '',
      rateLimitPerMin: selectedApp.settings?.rateLimitPerMin ?? 15,
      rateLimitPerDay: selectedApp.settings?.rateLimitPerDay ?? 200,
      allowedDomains:  selectedApp.settings?.allowedDomains  ?? '',
    })
    setErrors({})
    setNewKey(null)
  }, [selectedApp?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, val) =>
    setForm((p) => ({ ...p, [key]: key === 'primaryColor' ? val : sanitize(String(val)) }))

  const validate = () => {
    const e = {}
    if (!form.botName.trim())  e.botName  = 'Bot name is required.'
    if (!form.greeting.trim()) e.greeting = 'Greeting is required.'
    if (form.escalationEmail && !isValidEmail(form.escalationEmail)) e.escalationEmail = 'Enter a valid email.'
    if (form.escalationPhone && !isValidPhone(form.escalationPhone)) e.escalationPhone = 'Enter a valid phone number.'
    const rpm = parseInt(form.rateLimitPerMin)
    const rpd = parseInt(form.rateLimitPerDay)
    if (isNaN(rpm) || rpm < 1 || rpm > 60)   e.rateLimitPerMin = 'Must be 1–60.'
    if (isNaN(rpd) || rpd < 10 || rpd > 500) e.rateLimitPerDay = 'Must be 10–500.'
    return e
  }

  const save = async () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setErrors({})
    setSaving(true)
    try {
      await Promise.all([
        updateApp(selectedAppId, {
          name:           selectedApp.name,
          url:            selectedApp.url,
          primaryColor:   form.primaryColor,
          botName:        form.botName,
          welcomeMessage: form.greeting,
          active:         selectedApp.active,
          position:       form.widgetPosition,
        }),
        updateSettings(selectedAppId, {
          outOfScopeMsg:   form.outOfScopeMsg,
          escalationEmail: form.escalationEmail,
          escalationPhone: form.escalationPhone,
          rateLimitPerMin: form.rateLimitPerMin,
          rateLimitPerDay: form.rateLimitPerDay,
          allowedDomains:  form.allowedDomains,
        }),
      ])
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      console.error('Settings save error:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleRotateKey = async () => {
    if (!confirm('Rotating the key will immediately invalidate the current key. Continue?')) return
    setRotating(true)
    try {
      const raw = await createApiKey(selectedAppId)
      setNewKey(raw)
    } catch (err) {
      console.error('Key rotation error:', err)
    } finally {
      setRotating(false)
    }
  }

  const handleCopyKey = (key) => {
    navigator.clipboard.writeText(key).catch(() => {})
  }

  // ── No apps yet ──────────────────────────────────────────────────────────────
  if (apps.length === 0) {
    return (
      <div className="animate-fade-in">
        <div className="page-title">Settings</div>
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px', marginTop: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            Create an app first to configure its settings.
          </div>
        </div>
      </div>
    )
  }

  // Still loading settings from the selected app
  if (!form) {
    return (
      <div className="animate-fade-in">
        <div className="page-title">Settings</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 24 }}>Loading…</div>
      </div>
    )
  }

  const activeKeys    = selectedApp?.apiKeys?.filter((k) => k.active)  ?? []
  const inactiveKeys  = selectedApp?.apiKeys?.filter((k) => !k.active) ?? []

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 2 }}>
        <div className="page-title" style={{ margin: 0 }}>Settings</div>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>— {selectedApp?.name}</span>
      </div>
      <div className="page-sub">Configure chatbot behaviour, escalation, and security</div>

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

      {/* Bot tab */}
      {activeTab === 'bot' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Widget appearance</div>
            <Field label="Bot display name" field="botName" placeholder="AI Assistant" settings={form} set={set} errors={errors} />
            <div className="form-group">
              <label className="form-label">Accent colour</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="color" value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value)}
                  style={{ width: 40, height: 36, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 2 }} />
                <input className="form-input" value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} maxLength={7} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Widget position</label>
              <select className="form-input" value={form.widgetPosition} onChange={(e) => set('widgetPosition', e.target.value)}>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
              </select>
            </div>
          </div>
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Bot messages</div>
            <Field label="Greeting message" field="greeting" type="textarea" placeholder="Hi there 👋 How can I help?" settings={form} set={set} errors={errors} />
            <Field label="Out-of-scope response" field="outOfScopeMsg" type="textarea" placeholder="I'll connect you with our team…" hint="Shown when no knowledge base answer is found" settings={form} set={set} errors={errors} />
          </div>
        </div>
      )}

      {/* Escalation tab */}
      {activeTab === 'escalate' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Escalation channels</div>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.5 }}>
            When the bot can't answer, visitors are offered a way to reach your team. Configure where notifications are sent.
          </p>
          <Field label="Escalation email" field="escalationEmail" type="email" placeholder="support@yourcompany.com" hint="New escalations are forwarded here as email notifications" settings={form} set={set} errors={errors} />
          <Field label="WhatsApp / phone number" field="escalationPhone" type="tel" placeholder="+1 555 000 0000" hint="Used to notify your team via WhatsApp Business API" settings={form} set={set} errors={errors} />
          <div className="form-group">
            <label className="form-label">Rate limits</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label" style={{ marginBottom: 3 }}>Max msgs / min</label>
                <input type="number" className="form-input" value={form.rateLimitPerMin} min={1} max={60}
                  onChange={(e) => set('rateLimitPerMin', e.target.value)} />
                {errors.rateLimitPerMin && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{errors.rateLimitPerMin}</div>}
              </div>
              <div>
                <label className="form-label" style={{ marginBottom: 3 }}>Max msgs / day</label>
                <input type="number" className="form-input" value={form.rateLimitPerDay} min={10} max={500}
                  onChange={(e) => set('rateLimitPerDay', e.target.value)} />
                {errors.rateLimitPerDay && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{errors.rateLimitPerDay}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Security tab */}
      {activeTab === 'security' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Domain whitelist &amp; CORS</div>
          <Field
            label="Allowed domains (comma-separated)"
            field="allowedDomains"
            type="textarea"
            placeholder="yoursite.com, app.yoursite.com"
            hint="The widget will only load on these domains. Requests from other origins are blocked."
            settings={form} set={set} errors={errors}
          />
          <div style={{ marginTop: 8, padding: '12px 14px', background: 'var(--green-bg)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 8 }}>
            {[
              'TLS 1.3 in transit, AES-256 at rest',
              'XSS sanitisation on all user input',
              'CSP headers restrict script execution',
              'API keys hash-stored (SHA-256), never in plaintext',
              'GDPR-compliant data deletion on request',
            ].map((line) => (
              <div key={line} style={{ fontSize: 12.5, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span>✓</span> {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* API Keys tab */}
      {activeTab === 'api' && (
        <div className="card" style={{ maxWidth: 580 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>API Keys</div>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.5 }}>
            Your API key authenticates the embedded widget. Never expose it publicly — use environment variables on your server.
          </p>

          {/* Newly generated key (shown once) */}
          {newKey && (
            <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--green-bg)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, marginBottom: 6 }}>New key generated — copy it now, it won't be shown again</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', color: 'var(--text)', wordBreak: 'break-all' }}>{newKey}</code>
                <button className="btn btn-ghost btn-sm" onClick={() => handleCopyKey(newKey)}>Copy</button>
              </div>
            </div>
          )}

          {/* Active key */}
          {activeKeys.length > 0 ? (
            <div className="form-group">
              <label className="form-label">Active key</label>
              {activeKeys.map((k) => (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <code style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', color: 'var(--text2)', background: 'var(--bg3)', padding: '8px 12px', borderRadius: 6 }}>
                    {k.key_prefix}••••••••••••••••
                  </code>
                  <span className="tag tag-green" style={{ flexShrink: 0 }}>Active</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>No active key. Generate one below.</div>
          )}

          <div style={{ padding: '10px 14px', background: 'var(--amber-bg)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--amber)', marginBottom: 16, lineHeight: 1.5 }}>
            ⚠ Rotating your key immediately invalidates the old key and breaks any live embeds until you update the config.
          </div>
          <button className="btn btn-danger btn-sm" onClick={handleRotateKey} disabled={rotating}>
            {rotating ? 'Rotating…' : activeKeys.length > 0 ? 'Rotate key' : 'Generate key'}
          </button>

          {/* Revoked keys */}
          {inactiveKeys.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Revoked keys</div>
              {inactiveKeys.map((k) => (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <code style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)', background: 'var(--bg3)', padding: '6px 10px', borderRadius: 6, opacity: 0.6 }}>
                    {k.key_prefix}••••••••••••••••
                  </code>
                  <span className="tag tag-red" style={{ flexShrink: 0 }}>Revoked</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Save bar — only for bot/escalation/security tabs */}
      {activeTab !== 'api' && (
        <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  )
}
