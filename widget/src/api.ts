/** Calls to BotDesk's public API from the widget. */

export interface Citation {
  n: number
  title: string
  url: string | null
  citation: string | null
  section: string | null
  snippet: string
}

export interface Answer {
  text: string
  outcome: 'answered' | 'no_answer'
  citations: Citation[]
  offer_handoff: boolean
  disclaimer: string | null
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'agent'
  content: string
  citations?: Citation[]
  created_at: string
}

export interface BotInfo {
  id: string
  name: string
  title: string
  subtitle: string | null
  welcome_message: string
  primary_color: string
  position: 'bottom-right' | 'bottom-left'
  launcher_label: string | null
  suggested_questions: string[]
  show_sources: boolean
  avatar_url: string | null
  handoff: boolean
  disclaimer: string | null
}

export interface SessionInfo {
  session: string
  bot: BotInfo
  conversation: { id: string; status: 'open' | 'handoff' | 'resolved'; messages: Message[] } | null
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export class Api {
  session = ''
  constructor(private base: string, private key: string) {
    this.base = base.replace(/\/$/, '')
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.key,
        ...(this.session ? { 'x-session': this.session } : {}),
        ...(init.headers ?? {}),
      },
    })
    if (!res.ok) throw await toError(res)
    return res.json() as Promise<T>
  }

  async start(visitorId: string, botId?: string): Promise<SessionInfo> {
    const info = await this.req<SessionInfo>('/v1/widget/session', {
      method: 'POST',
      body: JSON.stringify({ visitor_id: visitorId, bot_id: botId, page_url: location.href.slice(0, 500), language: navigator.language }),
    })
    this.session = info.session
    return info
  }

  /** Streams an answer. Returns null when a person is handling the chat. */
  async chat(
    message: string,
    conversationId: string | null,
    onStart: (conversationId: string, userMessageId: string) => void,
    onDelta: (text: string) => void,
  ): Promise<{ conversationId: string; messageId: string | null; answer: Answer | null }> {
    const res = await fetch(`${this.base}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.key, 'x-session': this.session },
      body: JSON.stringify({ message, conversation_id: conversationId, stream: true }),
    })
    if (!res.ok) throw await toError(res)
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      const j = await res.json()
      onStart(j.conversation_id, j.message_id)
      return { conversationId: j.conversation_id, messageId: j.message_id, answer: j.answer }
    }

    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    let done: { conversationId: string; messageId: string | null; answer: Answer | null } | null = null
    while (true) {
      const { value, done: end } = await reader.read()
      if (end) break
      buf += value
      let i: number
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const event = frame.match(/^event: (.+)$/m)?.[1]
        const data = frame.match(/^data: (.+)$/m)?.[1]
        if (!event || !data) continue
        const j = JSON.parse(data)
        if (event === 'start') onStart(j.conversation_id, j.user_message_id)
        else if (event === 'delta') onDelta(j.text)
        else if (event === 'done') done = { conversationId: j.conversation_id, messageId: j.message_id, answer: j.answer }
        else if (event === 'error') throw new ApiError(500, j.code ?? 'error', j.message ?? 'Something went wrong.')
      }
    }
    if (!done) throw new ApiError(500, 'interrupted', 'The answer was interrupted. Please try again.')
    return done
  }

  messages(conversationId: string, after?: string) {
    const q = new URLSearchParams({ session: this.session, ...(after ? { after } : {}) })
    return this.req<{ conversation: { status: string }; messages: Message[] }>(`/v1/conversations/${conversationId}/messages?${q}`)
  }

  handoff(conversationId: string, contact: { name?: string; email?: string; phone?: string; note?: string }) {
    return this.req<{ ok: boolean; message: string }>('/v1/handoff', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: conversationId, ...contact }),
    })
  }

  feedback(messageId: string, rating: 1 | -1) {
    return this.req<{ ok: boolean }>('/v1/feedback', { method: 'POST', body: JSON.stringify({ message_id: messageId, rating }) })
  }
}

async function toError(res: Response): Promise<ApiError> {
  let code = 'error'
  let message = 'Something went wrong. Please try again.'
  try {
    const j = await res.json()
    code = j.error?.code ?? code
    message = j.error?.message ?? message
  } catch {
    // keep defaults
  }
  if (res.status === 429) message = 'You are sending messages quickly. Please wait a moment.'
  return new ApiError(res.status, code, message)
}
