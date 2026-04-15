import { useState } from 'react'
import { useLocation } from 'react-router-dom'

const TITLES = {
  '/':              'Overview',
  '/conversations': 'Conversations',
  '/knowledge':     'Knowledge Base',
  '/embed':         'Embed & Deploy',
  '/settings':      'Settings',
}

export default function Topbar({ theme, setTheme, themes }) {
  const location = useLocation()
  const title    = TITLES[location.pathname] || 'Dashboard'
  const [open, setOpen] = useState(false)

  const current = themes.find((t) => t.id === theme) || themes[0]

  return (
    <div style={{
      height: 56, borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', gap: 16,
      background: 'var(--bg2)',
    }}>
      <div style={{ fontSize: 15, fontWeight: 500 }}>{title}</div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Theme switcher */}
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setOpen((o) => !o)}
            style={{ fontSize: 12, gap: 6 }}
          >
            {current.icon} {current.label}
          </button>

          {open && (
            <>
              {/* Backdrop to close on outside click */}
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                onClick={() => setOpen(false)}
              />
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                background: 'var(--bg2)', border: '1px solid var(--border2)',
                borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                zIndex: 100, minWidth: 210,
                boxShadow: 'var(--shadow)',
              }}>
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTheme(t.id); setOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '9px 14px',
                      background: t.id === theme ? 'var(--accent-bg)' : 'transparent',
                      color: t.id === theme ? 'var(--accent)' : 'var(--text2)',
                      border: 'none', cursor: 'pointer',
                      fontSize: 12, fontFamily: 'var(--font-sans)',
                      transition: 'background 0.1s',
                    }}
                  >
                    <span>{t.icon}</span>
                    <span>{t.label}</span>
                    {t.id === theme && (
                      <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.7 }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>📤 Export</button> */}
      </div>
    </div>
  )
}
