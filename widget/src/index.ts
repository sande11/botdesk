/**
 * BotDesk web widget. Add to any site:
 *
 *   <script src="https://YOUR-BOTDESK/widget.js" async
 *     data-key="bd_pk_..." data-api="https://<ref>.supabase.co/functions/v1/api"></script>
 *
 * or set window.BotDeskConfig = { apiKey, apiUrl, botId?, open?, theme? } first.
 * Then window.BotDesk.open() / close() / toggle() / ask(text) are available.
 */
import { Api, ApiError, type Answer, type BotInfo, type Citation, type Message } from './api.ts'
import { escapeHtml, renderMarkdown } from './markdown.ts'
import { CSS } from './styles.ts'

interface Config {
  apiKey: string
  apiUrl: string
  botId?: string
  open?: boolean
  theme?: 'light' | 'auto'
}

const ICONS = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  minimize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>',
  bot: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></svg>',
}

function storage(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value)
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function visitorId(): string {
  const existing = storage('botdesk.visitor')
  if (existing && /^[A-Za-z0-9_-]{8,100}$/.test(existing)) return existing
  const id = 'v_' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')
  storage('botdesk.visitor', id)
  return id
}

function readConfig(): Config | null {
  const w = window as unknown as { BotDeskConfig?: Partial<Config> }
  const script = document.currentScript as HTMLScriptElement | null ??
    document.querySelector<HTMLScriptElement>('script[data-key][src*="widget"]')
  const cfg: Partial<Config> = {
    apiKey: script?.dataset.key,
    apiUrl: script?.dataset.api,
    botId: script?.dataset.bot,
    open: script?.dataset.open === 'true',
    theme: script?.dataset.theme === 'auto' ? 'auto' : 'light',
    ...(w.BotDeskConfig ?? {}),
  }
  if (!cfg.apiKey || !cfg.apiUrl) {
    console.warn('[BotDesk] Missing data-key or data-api on the widget script.')
    return null
  }
  return cfg as Config
}

class Widget {
  private api: Api
  private root!: ShadowRoot
  private el!: { wrap: HTMLElement; launcher: HTMLButtonElement; panel: HTMLElement; log: HTMLElement; input: HTMLTextAreaElement; send: HTMLButtonElement; chips: HTMLElement; live: HTMLElement }
  private bot: BotInfo | null = null
  private conversationId: string | null = null
  private status: 'open' | 'handoff' | 'resolved' = 'open'
  private busy = false
  private lastSeen = ''
  private poller: number | null = null
  private unread = 0
  private shownIds = new Set<string>()

  constructor(private cfg: Config) {
    this.api = new Api(cfg.apiUrl, cfg.apiKey)
  }

  async mount() {
    const host = document.createElement('div')
    host.id = 'botdesk-widget'
    document.body.appendChild(host)
    this.root = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = CSS
    this.root.appendChild(style)

    let info
    try {
      info = await this.api.start(visitorId(), this.cfg.botId)
    } catch (err) {
      console.warn('[BotDesk] Could not start:', (err as Error).message)
      host.remove()
      return
    }
    this.bot = info.bot
    this.build()
    if (info.conversation) {
      this.conversationId = info.conversation.id
      this.status = info.conversation.status
      for (const m of info.conversation.messages) this.renderStored(m)
      if (this.status === 'handoff') this.startPolling()
    }
    if (!this.el.log.querySelector('.msg')) this.addBot(info.bot.welcome_message, [], null, null)
    this.renderChips()
    if (this.cfg.open || storage('botdesk.open') === '1') this.open()
  }

  private build() {
    const b = this.bot!
    const wrap = document.createElement('div')
    wrap.className = `bd ${b.position === 'bottom-left' ? 'left' : 'right'} ${this.cfg.theme === 'auto' ? 'auto' : ''}`
    wrap.style.setProperty('--bd-primary', b.primary_color)
    wrap.style.setProperty('--bd-on-primary', readableOn(b.primary_color))
    wrap.innerHTML = `
      <div class="panel" role="dialog" aria-label="${escapeHtml(b.title)}" hidden>
        <div class="head">
          <div class="avatar">${b.avatar_url ? `<img src="${escapeHtml(b.avatar_url)}" alt="">` : ICONS.bot}</div>
          <div class="head-text"><div class="title">${escapeHtml(b.title)}</div>${
      b.subtitle ? `<div class="subtitle">${escapeHtml(b.subtitle)}</div>` : ''
    }</div>
          <button type="button" class="icon-btn" data-act="close" aria-label="Close chat">${ICONS.minimize}</button>
        </div>
        <div class="log" role="log" aria-live="polite"></div>
        <div class="chips"></div>
        <form class="compose">
          <label class="sr" for="bd-input">Message</label>
          <textarea id="bd-input" rows="1" maxlength="4000" placeholder="Type your question…"></textarea>
          <button type="submit" class="send" aria-label="Send" disabled>${ICONS.send}</button>
        </form>
        <div class="foot"><a href="https://botdesk.ai" target="_blank" rel="noopener">Powered by BotDesk</a></div>
        <div class="sr" aria-live="assertive"></div>
      </div>
      <button type="button" class="launcher ${b.launcher_label ? '' : 'icon-only'}" aria-label="Open chat" aria-expanded="false">
        ${ICONS.chat}${b.launcher_label ? `<span>${escapeHtml(b.launcher_label)}</span>` : ''}
      </button>`
    this.root.appendChild(wrap)

    const q = <T extends Element>(s: string) => wrap.querySelector(s) as T
    this.el = {
      wrap,
      launcher: q('.launcher'),
      panel: q('.panel'),
      log: q('.log'),
      input: q('textarea'),
      send: q('.send'),
      chips: q('.chips'),
      live: q('.sr[aria-live="assertive"]'),
    }

    this.el.launcher.addEventListener('click', () => this.toggle())
    q<HTMLButtonElement>('[data-act="close"]').addEventListener('click', () => this.close())
    this.el.panel.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.close()
    })
    this.el.input.addEventListener('input', () => {
      this.el.send.disabled = !this.el.input.value.trim() || this.busy
      this.el.input.style.height = 'auto'
      this.el.input.style.height = Math.min(this.el.input.scrollHeight, 120) + 'px'
    })
    this.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        this.submit()
      }
    })
    q<HTMLFormElement>('form').addEventListener('submit', (e) => {
      e.preventDefault()
      this.submit()
    })
    this.el.log.addEventListener('click', (e) => {
      const cite = (e.target as HTMLElement).closest<HTMLElement>('.bd-cite')
      if (cite) this.showCitation(cite)
    })
  }

  // ── Open / close ───────────────────────────────────────────────────────

  open() {
    if (!this.el) return
    this.el.panel.hidden = false
    this.el.launcher.setAttribute('aria-expanded', 'true')
    this.el.launcher.setAttribute('aria-label', 'Close chat')
    this.el.launcher.innerHTML = ICONS.close
    this.el.launcher.classList.add('icon-only')
    this.unread = 0
    storage('botdesk.open', '1')
    this.scroll()
    setTimeout(() => this.el.input.focus(), 50)
  }

  close() {
    if (!this.el) return
    this.el.panel.hidden = true
    this.el.launcher.setAttribute('aria-expanded', 'false')
    this.el.launcher.setAttribute('aria-label', 'Open chat')
    this.renderLauncher()
    storage('botdesk.open', '0')
    this.el.launcher.focus()
  }

  toggle() {
    if (this.el?.panel.hidden) this.open()
    else this.close()
  }

  private renderLauncher() {
    const b = this.bot!
    this.el.launcher.classList.toggle('icon-only', !b.launcher_label)
    this.el.launcher.innerHTML = ICONS.chat + (b.launcher_label ? `<span>${escapeHtml(b.launcher_label)}</span>` : '') +
      (this.unread ? `<span class="unread" aria-label="${this.unread} new">${this.unread}</span>` : '')
  }

  // ── Messages ───────────────────────────────────────────────────────────

  private scroll() {
    this.el.log.scrollTop = this.el.log.scrollHeight
  }

  private announce(text: string) {
    this.el.live.textContent = text.slice(0, 300)
  }

  private renderChips() {
    const qs = this.bot?.suggested_questions ?? []
    const empty = !this.el.log.querySelector('.msg.user')
    this.el.chips.innerHTML = ''
    if (!empty) return
    for (const q of qs) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'chip'
      b.textContent = q
      b.addEventListener('click', () => this.send(q))
      this.el.chips.appendChild(b)
    }
  }

  private addUser(text: string) {
    const m = document.createElement('div')
    m.className = 'msg user'
    m.innerHTML = `<div class="bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
    this.el.log.appendChild(m)
    this.scroll()
  }

  private addBot(text: string, citations: Citation[], messageId: string | null, disclaimer: string | null, who: 'bot' | 'agent' = 'bot') {
    const m = document.createElement('div')
    m.className = `msg ${who}`
    this.fillBot(m, text, citations, messageId, disclaimer, who)
    this.el.log.appendChild(m)
    this.scroll()
    return m
  }

  private fillBot(m: HTMLElement, text: string, citations: Citation[], messageId: string | null, disclaimer: string | null, who: 'bot' | 'agent' = 'bot') {
    const show = this.bot?.show_sources !== false && citations.length > 0
    m.innerHTML = (who === 'agent' ? '<div class="who">Team</div>' : '') +
      `<div class="bubble">${renderMarkdown(text, show ? citations.length : 0)}</div>` +
      (show
        ? `<details class="sources"><summary>${citations.length} source${citations.length > 1 ? 's' : ''}</summary><ol>${
          citations.map((c) =>
            `<li data-n="${c.n}"><span class="src-title">${
              c.url
                ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(label(c))}</a>`
                : escapeHtml(label(c))
            }</span><br>${escapeHtml(c.snippet)}</li>`
          ).join('')
        }</ol></details>`
        : '') +
      (disclaimer ? `<div class="disclaimer">${escapeHtml(disclaimer)}</div>` : '') +
      (messageId && who === 'bot'
        ? `<div class="meta"><button type="button" class="fb" data-r="1" aria-label="Helpful">${ICONS.up}</button><button type="button" class="fb" data-r="-1" aria-label="Not helpful">${ICONS.down}</button></div>`
        : '')
    if (messageId) {
      for (const b of m.querySelectorAll<HTMLButtonElement>('.fb')) {
        b.addEventListener('click', () => {
          const rating = Number(b.dataset.r) as 1 | -1
          m.querySelectorAll('.fb').forEach((x) => x.classList.remove('on'))
          b.classList.add('on')
          b.setAttribute('aria-pressed', 'true')
          this.api.feedback(messageId, rating).catch(() => {})
        })
      }
    }
  }

  private showCitation(btn: HTMLElement) {
    const msg = btn.closest('.msg')
    const details = msg?.querySelector<HTMLDetailsElement>('details.sources')
    if (!details) return
    details.open = true
    details.querySelectorAll('li').forEach((li) => li.classList.toggle('hl', li.dataset.n === btn.dataset.cite))
    details.querySelector<HTMLElement>(`li[data-n="${btn.dataset.cite}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  private note(text: string, error = false) {
    const n = document.createElement('div')
    n.className = `note${error ? ' err' : ''}`
    n.textContent = text
    this.el.log.appendChild(n)
    this.scroll()
  }

  private renderStored(m: Message) {
    if (this.shownIds.has(m.id)) return
    this.shownIds.add(m.id)
    if (m.created_at > this.lastSeen) this.lastSeen = m.created_at
    if (m.role === 'user') this.addUser(m.content)
    else this.addBot(m.content, m.citations ?? [], m.role === 'assistant' ? m.id : null, null, m.role === 'agent' ? 'agent' : 'bot')
  }

  // ── Sending ────────────────────────────────────────────────────────────

  private submit() {
    const text = this.el.input.value.trim()
    if (!text || this.busy) return
    this.el.input.value = ''
    this.el.input.style.height = 'auto'
    this.send(text)
  }

  async send(text: string) {
    if (this.busy) return
    this.busy = true
    this.el.send.disabled = true
    this.el.chips.innerHTML = ''
    this.addUser(text)

    const m = document.createElement('div')
    m.className = 'msg bot'
    m.innerHTML = '<div class="bubble"><span class="dots" aria-label="Typing"><span></span><span></span><span></span></span></div>'
    if (this.status !== 'handoff') {
      this.el.log.appendChild(m)
      this.scroll()
    }

    let streamed = ''
    try {
      const res = await this.api.chat(
        text,
        this.conversationId,
        (cid) => (this.conversationId = cid),
        (delta) => {
          streamed += delta
          m.querySelector('.bubble')!.innerHTML = renderMarkdown(streamed)
          this.scroll()
        },
      )
      this.conversationId = res.conversationId
      if (!res.answer) {
        // A person is handling this conversation.
        m.remove()
        this.status = 'handoff'
        this.startPolling()
        return
      }
      this.finishAnswer(m, res.answer, res.messageId)
    } catch (err) {
      m.remove()
      if (err instanceof ApiError && err.code === 'session_expired') {
        this.note('Reconnecting…')
        await this.api.start(visitorId(), this.cfg.botId).catch(() => {})
      }
      this.note(err instanceof ApiError ? err.message : 'Could not reach the assistant. Check your connection and try again.', true)
    } finally {
      this.busy = false
      this.el.send.disabled = !this.el.input.value.trim()
    }
  }

  private finishAnswer(m: HTMLElement, a: Answer, messageId: string | null) {
    if (messageId) this.shownIds.add(messageId)
    this.fillBot(m, a.text, a.citations, messageId, a.outcome === 'answered' ? a.disclaimer : null)
    this.announce(a.text)
    if (a.offer_handoff && this.bot?.handoff) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'action'
      btn.textContent = 'Talk to a person'
      btn.addEventListener('click', () => {
        btn.remove()
        this.handoffForm()
      })
      this.el.log.appendChild(btn)
    }
    this.lastSeen = new Date().toISOString()
    this.scroll()
  }

  private handoffForm() {
    const f = document.createElement('form')
    f.className = 'form'
    f.innerHTML = `
      <label>Your name<input name="name" autocomplete="name" maxlength="120"></label>
      <label>Email (so we can reply if you leave)<input name="email" type="email" autocomplete="email" maxlength="200"></label>
      <label>Anything to add?<textarea name="note" rows="2" maxlength="1000"></textarea></label>
      <div class="row"><button type="button" class="btn ghost">Cancel</button><button type="submit" class="btn">Connect me</button></div>`
    f.querySelector('.ghost')!.addEventListener('click', () => f.remove())
    f.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (!this.conversationId) return
      const data = Object.fromEntries(new FormData(f).entries()) as Record<string, string>
      const btn = f.querySelector<HTMLButtonElement>('button[type="submit"]')!
      btn.disabled = true
      try {
        const r = await this.api.handoff(this.conversationId, data)
        f.remove()
        this.status = 'handoff'
        this.note(r.message)
        this.startPolling()
      } catch (err) {
        btn.disabled = false
        this.note((err as Error).message, true)
      }
    })
    this.el.log.appendChild(f)
    this.scroll()
    f.querySelector('input')?.focus()
  }

  // ── Replies from people ────────────────────────────────────────────────

  private startPolling() {
    if (this.poller !== null) return
    const tick = async () => {
      if (!this.conversationId) return
      try {
        const r = await this.api.messages(this.conversationId, this.lastSeen || undefined)
        for (const msg of r.messages) {
          if (this.shownIds.has(msg.id)) continue
          if (msg.role === 'agent') {
            this.renderStored(msg)
            this.announce(msg.content)
            if (this.el.panel.hidden) {
              this.unread++
              this.renderLauncher()
            }
          } else {
            this.shownIds.add(msg.id)
            if (msg.created_at > this.lastSeen) this.lastSeen = msg.created_at
          }
        }
        this.status = r.conversation.status as typeof this.status
      } catch {
        // try again next tick
      }
      this.poller = window.setTimeout(tick, this.el.panel.hidden ? 15_000 : 4_000)
    }
    this.poller = window.setTimeout(tick, 2_000)
  }
}

function label(c: Citation): string {
  const base = c.citation || c.title
  return c.section && !base.includes(c.section) ? `${base} · ${c.section}` : base
}

/** White or near-black text, whichever reads better on the brand colour. */
function readableOn(hex: string): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return '#ffffff'
  const [r, g, b] = m.slice(1).map((x) => {
    const c = parseInt(x, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.45 ? '#111114' : '#ffffff'
}

;(function boot() {
  const w = window as unknown as { BotDesk?: unknown }
  if (w.BotDesk) return // loaded twice
  const cfg = readConfig()
  if (!cfg) return
  const widget = new Widget(cfg)
  w.BotDesk = {
    open: () => widget.open(),
    close: () => widget.close(),
    toggle: () => widget.toggle(),
    ask: (text: string) => {
      widget.open()
      return widget.send(text)
    },
  }
  const start = () => widget.mount()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()

export { readableOn }
