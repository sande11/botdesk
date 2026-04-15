import { useLocation, useNavigate } from 'react-router-dom'

const NAV = [
  { group: 'Dashboard',     items: [
    { path: '/',                icon: '🏠',   label: 'Overview'        },
    { path: '/conversations',   icon: '💬',   label: 'Conversations', badge: 3 },
  ]},
  { group: 'Configuration', items: [
    { path: '/apps',            icon: '🌐',   label: 'Apps'            },
    { path: '/knowledge',       icon: '📚',   label: 'Knowledge Base'  },
    { path: '/embed',           icon: '⟨/⟩',  label: 'Embed & Deploy'  },
    { path: '/settings',        icon: '⚙',    label: 'Settings'        },
  ]},
]

export default function Sidebar() {
  const location  = useLocation()
  const navigate  = useNavigate()
  const isActive  = (path) => location.pathname === path

  return (
    <aside style={{
      width: 220, flexShrink: 0,
      background: 'var(--bg2)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      padding: '20px 12px',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 20px' }}>
        <div style={{ width: 30, height: 30, background: 'var(--accent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🤖</div>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--text)' }}>BotDesk</span>
      </div>

      {/* Nav groups */}
      {NAV.map((group) => (
        <div key={group.group} style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 8px 4px', fontWeight: 500 }}>{group.group}</div>
          {group.items.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '9px 10px', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', width: '100%', textAlign: 'left',
                fontSize: 13.5, fontWeight: isActive(item.path) ? 500 : 400,
                border: 'none', fontFamily: 'var(--font-sans)',
                background: isActive(item.path) ? 'var(--accent-bg)' : 'transparent',
                color: isActive(item.path) ? 'var(--accent2)' : 'var(--text2)',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{item.icon}</span>
              {item.label}
              {item.badge && !isActive(item.path) && (
                <span style={{ marginLeft: 'auto', background: 'var(--accent-chip-bg)', color: 'var(--accent-chip-fg)', fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 600 }}>{item.badge}</span>
              )}
            </button>
          ))}
        </div>
      ))}

      {/* Bottom user */}
      <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
          <div className="online-dot" />
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>Admin</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>admin@yoursite.com</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
