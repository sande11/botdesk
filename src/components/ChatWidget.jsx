import { useState, useEffect, useRef, useCallback } from 'react'
import { sanitize, isValidEmail, isValidPhone, truncate } from '../utils/security.js'
import { generateId } from '../utils/helpers.js'
import { findAnswer } from '../utils/knowledgeBase.js'
import { useRateLimit } from '../hooks/useRateLimit.js'

const DEFAULT_CONFIG = {
  primaryColor:    '#7c6df8',
  welcomeMessage:  "Hi there 👋 I'm your AI assistant. Ask me anything about our product!",
  botName:         'AI Assistant',
  position:        'bottom-right',
  escalationEmail: '',
}

/**
 * ChatWidget
 * The floating chat bubble + window.
 * When `standalone` prop is true (widget-entry.jsx), it renders fixed to the viewport.
 * When used inside the dashboard, it does the same — demonstrating how it'll look on a live site.
 *
 * @param {{ config?: object, standalone?: boolean }} props
 */
export default function ChatWidget({ config = {}, standalone = false, knowledgeBase }) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const accent = cfg.primaryColor

  const [open, setOpen]           = useState(false)
  const [msgs, setMsgs]           = useState([
    { id: 'w0', role: 'bot', content: cfg.welcomeMessage, ts: new Date() }
  ])
  const [input, setInput]         = useState('')
  const [typing, setTyping]       = useState(false)
  const [showEsc, setShowEsc]     = useState(false)
  const [escData, setEscData]     = useState({ email: '', whatsapp: '' })
  const [escErrors, setEscErrors] = useState({})
  const [escSent, setEscSent]     = useState(false)
  const [unread, setUnread]       = useState(0)

  const msgsEndRef = useRef(null)
  const inputRef   = useRef(null)
  const { check: checkRate } = useRateLimit(15, 60_000)

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, typing])

  useEffect(() => {
    if (open) {
      setUnread(0)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const addMsg = (role, content) => {
    const msg = { id: generateId(), role, content, ts: new Date() }
    setMsgs((p) => [...p, msg])
    return msg
  }

  const sendMessage = useCallback(() => {
    const text = truncate(sanitize(input.trim()), 500)
    if (!text || typing) return

    if (!checkRate()) {
      addMsg('bot', 'You\'re sending messages too quickly. Please wait a moment before trying again.')
      setInput('')
      return
    }

    addMsg('user', text)
    setInput('')
    setTyping(true)

    // Simulate network latency + AI thinking time
    const delay = 800 + Math.random() * 700
    setTimeout(() => {
      setTyping(false)
      const result = findAnswer(text, knowledgeBase)
      if (result) {
        addMsg('bot', result.answer)
      } else {
        addMsg('bot', "That's a great question! I don't have that in my knowledge base right now. Let me connect you with our team — they'll get back to you quickly.")
        setTimeout(() => setShowEsc(true), 500)
      }
      if (!open) setUnread((n) => n + 1)
    }, delay)
  }, [input, typing, open, checkRate])

  const validateEsc = () => {
    const errs = {}
    if (!escData.email && !escData.whatsapp) {
      errs.general = 'Please provide at least one contact method.'
    }
    if (escData.email && !isValidEmail(escData.email)) {
      errs.email = 'Please enter a valid email address.'
    }
    if (escData.whatsapp && !isValidPhone(escData.whatsapp)) {
      errs.whatsapp = 'Please enter a valid phone number.'
    }
    return errs
  }

  const submitEsc = () => {
    const errs = validateEsc()
    if (Object.keys(errs).length > 0) { setEscErrors(errs); return }
    setShowEsc(false)
    setEscSent(true)
    addMsg('escalation',
      `✓ Our team has been notified${escData.email ? ` · ${sanitize(escData.email)}` : ''}${escData.whatsapp ? ` · WhatsApp: ${sanitize(escData.whatsapp)}` : ''}. Expect a reply within 2 hours.`
    )
  }

  const s = {
    container: {
      position:    'fixed',
      bottom:      24,
      right:       24,
      zIndex:      99999,
      fontFamily:  "'DM Sans', system-ui, sans-serif",
    },
    bubble: {
      width:        52, height: 52, borderRadius: '50%',
      background:   accent,
      display:      'flex', alignItems: 'center', justifyContent: 'center',
      cursor:       'pointer',
      boxShadow:    `0 4px 20px ${accent}80`,
      border:       'none',
      fontSize:     22,
      transition:   'transform 0.2s, box-shadow 0.2s',
      position:     'relative',
    },
    window: {
      position:    'absolute', bottom: 64, right: 0,
      width:       360, maxHeight: 520,
      background:  '#13131a',
      border:      '1px solid rgba(255,255,255,0.12)',
      borderRadius: 16,
      boxShadow:   '0 8px 32px rgba(0,0,0,0.5)',
      display:     'flex', flexDirection: 'column',
      overflow:    'hidden',
      animation:   'bd-slideUp 0.22s ease',
    },
    header: {
      padding:        '14px 16px',
      background:     accent,
      display:        'flex', alignItems: 'center', gap: 10,
    },
    msgs: {
      flex: 1, overflowY: 'auto', padding: 14,
      display: 'flex', flexDirection: 'column', gap: 10,
      maxHeight: 340,
    },
    inputRow: {
      padding:       12, borderTop: '1px solid rgba(255,255,255,0.07)',
      display:       'flex', gap: 8,
    },
    input: {
      flex: 1,
      background:   '#1a1a24', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 8, padding: '9px 12px',
      color:        '#f0eff5', fontSize: 13,
      fontFamily:   "'DM Sans', system-ui, sans-serif",
      outline:      'none',
    },
    sendBtn: {
      width: 34, height: 34, background: accent, border: 'none',
      borderRadius: 8, color: 'white', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, flexShrink: 0, alignSelf: 'flex-end',
    },
  }

  const BotBubble = ({ content }) => (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
      <div style={{ width: 24, height: 24, background: accent, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginTop: 2 }}>🤖</div>
      <div style={{ background: '#1a1a24', color: '#f0eff5', padding: '9px 12px', borderRadius: '4px 10px 10px 10px', fontSize: 13, lineHeight: 1.55, maxWidth: '86%' }}>{content}</div>
    </div>
  )

  const UserBubble = ({ content }) => (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ background: accent, color: 'white', padding: '9px 12px', borderRadius: '10px 4px 10px 10px', fontSize: 13, lineHeight: 1.55, maxWidth: '86%' }}>{content}</div>
    </div>
  )

  const EscBubble = ({ content }) => (
    <div style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, padding: '7px 10px', fontSize: 12, textAlign: 'center', alignSelf: 'center', width: '90%', margin: '0 auto' }}>{content}</div>
  )

  return (
    <div style={s.container}>
      {open && (
        <div style={s.window}>
          {/* Header */}
          <div style={s.header}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'white' }}>{cfg.botName}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>● Online · Typically replies instantly</div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
          </div>

          {/* Messages */}
          <div style={s.msgs}>
            {msgs.map((m) => (
              <div key={m.id}>
                {m.role === 'bot'        && <BotBubble content={m.content} />}
                {m.role === 'user'       && <UserBubble content={m.content} />}
                {m.role === 'escalation' && <EscBubble content={m.content} />}
              </div>
            ))}
            {typing && (
              <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                <div style={{ width: 24, height: 24, background: accent, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>🤖</div>
                <div style={{ background: '#1a1a24', padding: '10px 14px', borderRadius: '4px 10px 10px 10px', display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[0, 0.2, 0.4].map((delay, i) => (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#5c5b70', animation: `bd-bounce 1.2s ${delay}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={msgsEndRef} />
          </div>

          {/* Input */}
          <div style={s.inputRow}>
            <input
              ref={inputRef}
              style={s.input}
              placeholder="Ask me anything…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              maxLength={500}
            />
            <button style={{ ...s.sendBtn, opacity: (!input.trim() || typing) ? 0.5 : 1 }} onClick={sendMessage} disabled={!input.trim() || typing}>→</button>
          </div>
        </div>
      )}

      {/* Escalation modal */}
      {showEsc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => e.target === e.currentTarget && setShowEsc(false)}>
          <div style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: 28, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', fontFamily: "'DM Sans', sans-serif" }}>
            <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, color: '#f0eff5', marginBottom: 8 }}>Connect with our team</div>
            <p style={{ fontSize: 13, color: '#9998a8', marginBottom: 20, lineHeight: 1.5 }}>Leave your contact details and a human agent will follow up personally — usually within 2 hours.</p>
            {escErrors.general && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>{escErrors.general}</div>}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#9998a8', marginBottom: 5, fontWeight: 500 }}>Email address</label>
              <input type="email" placeholder="you@example.com" value={escData.email} maxLength={100}
                onChange={(e) => setEscData((p) => ({ ...p, email: e.target.value }))}
                style={{ width: '100%', background: '#1a1a24', border: `1px solid ${escErrors.email ? '#f87171' : 'rgba(255,255,255,0.12)'}`, borderRadius: 8, padding: '10px 12px', color: '#f0eff5', fontSize: 13, outline: 'none', fontFamily: "'DM Sans', sans-serif" }} />
              {escErrors.email && <div style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>{escErrors.email}</div>}
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#9998a8', marginBottom: 5, fontWeight: 500 }}>WhatsApp number <span style={{ color: '#5c5b70' }}>(optional)</span></label>
              <input type="tel" placeholder="+1 555 000 0000" value={escData.whatsapp} maxLength={20}
                onChange={(e) => setEscData((p) => ({ ...p, whatsapp: e.target.value }))}
                style={{ width: '100%', background: '#1a1a24', border: `1px solid ${escErrors.whatsapp ? '#f87171' : 'rgba(255,255,255,0.12)'}`, borderRadius: 8, padding: '10px 12px', color: '#f0eff5', fontSize: 13, outline: 'none', fontFamily: "'DM Sans', sans-serif" }} />
              {escErrors.whatsapp && <div style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>{escErrors.whatsapp}</div>}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowEsc(false)} style={{ padding: '7px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#9998a8', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Maybe later</button>
              <button onClick={submitEsc} style={{ padding: '7px 14px', background: accent, border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Notify our team</button>
            </div>
          </div>
        </div>
      )}

      {/* Floating bubble */}
      <button
        style={s.bubble}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)' }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
        aria-label="Open chat"
      >
        {open ? '×' : '💬'}
        {!open && unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, background: '#f87171', borderRadius: '50%', fontSize: 10, fontWeight: 700, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unread}</span>
        )}
      </button>
    </div>
  )
}
