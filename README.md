# BotDesk — AI Chatbot Admin Dashboard

A production-ready React application that combines:
- **Admin dashboard** to manage conversations, knowledge base, settings & embed code
- **Embeddable chat widget** that can be dropped onto any website (Framer, Webflow, WordPress, etc.)
- **RAG-style knowledge base** — the bot only answers from your data; out-of-scope questions escalate to email / WhatsApp

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (opens on http://localhost:3000)
npm run dev
```

---

## Project Structure

```
botdesk/
├── index.html                  # HTML shell
├── vite.config.js              # Vite config for main app
├── vite.widget.config.js       # Vite config for widget bundle
├── package.json
├── public/
│   └── favicon.svg
└── src/
    ├── main.jsx                # App entry point
    ├── widget-entry.jsx        # Standalone widget entry (for embed)
    ├── App.jsx                 # Root — BrowserRouter + layout
    ├── styles/
    │   ├── global.css          # Design tokens + shared utility classes
    │   └── widget.css          # Widget-scoped styles (standalone embed)
    ├── utils/
    │   ├── security.js         # sanitize(), rate limiter, validators
    │   ├── helpers.js          # formatTime, copyToClipboard, etc.
    │   ├── knowledgeBase.js    # RAG lookup engine + default KB
    │   └── mockData.js         # Demo conversations + stats
    ├── hooks/
    │   ├── useRateLimit.js     # Per-session rate limiter hook
    │   └── useConversations.js # Conversation state management
    ├── components/
    │   ├── ChatWidget.jsx      # The floating chat bubble + window
    │   ├── Sidebar.jsx         # Navigation sidebar
    │   └── Topbar.jsx          # Top bar with page title
    └── pages/
        ├── Overview.jsx        # Stats + charts
        ├── Conversations.jsx   # Conversation list + transcript
        ├── KnowledgeBase.jsx   # Manage Q&A entries
        ├── Embed.jsx           # Embed code + integration guides
        └── Settings.jsx        # Bot config, escalation, security, API keys
```

---

## Building the Embeddable Widget

The widget is a **separate build** that produces a self-contained IIFE bundle:

```bash
npm run build:widget
# Output: dist-widget/widget.iife.js
```

### Embed on any website

```html
<script>
  window.BotDeskConfig = {
    apiKey:         'YOUR_API_KEY_HERE',
    primaryColor:   '#7c6df8',
    botName:        'AI Assistant',
    welcomeMessage: 'Hi! How can I help you today?',
    position:       'bottom-right'
  };
  (function () {
    var s = document.createElement('script');
    s.src   = 'https://YOUR_DOMAIN/widget.iife.js';
    s.async = true;
    document.body.appendChild(s);
  })();
</script>
```

### Framer

1. Open your Framer project → **Site Settings** (gear icon)
2. Go to **General → Custom Code**
3. Paste the script above into **"End of `<body>` tag"**
4. Replace `YOUR_API_KEY_HERE` and `YOUR_DOMAIN`
5. **Publish**

---

## Connecting a Real Backend

The project ships with mock data and a keyword-based RAG engine. To go live:

### 1. Replace the knowledge base lookup

Edit `src/utils/knowledgeBase.js` — swap `findAnswer()` with a `fetch()` call to your vector-search API:

```js
export async function findAnswer(message) {
  const res = await fetch('/api/search', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YOUR_KEY },
    body:    JSON.stringify({ query: message })
  })
  const data = await res.json()
  return data.answer ? { answer: data.answer } : null
}
```

### 2. Replace mock conversations

Edit `src/hooks/useConversations.js` — replace the `useState(MOCK_CONVERSATIONS)` with a `useEffect` that fetches from your backend.

### 3. Recommended backend stack

| Layer              | Recommendation              | Cost              |
|--------------------|-----------------------------|-------------------|
| API server         | Node.js + Express / Next.js | Free              |
| Vector DB          | Supabase pgvector           | Free tier         |
| Embeddings         | OpenAI text-embedding-3-small | ~$0.02 / 1M tokens |
| LLM                | Claude API (claude-haiku)   | Pay per use       |
| Hosting            | Vercel                      | Free tier         |
| WhatsApp           | Meta Cloud API              | Free (1k conv/mo) |
| Email              | Resend                      | Free tier         |

---

## Security Architecture

- **XSS prevention** — all user input is HTML-encoded via `sanitize()` before render
- **Rate limiting** — per-session sliding-window limiter (default: 15 msg/min)
- **Input length caps** — `maxLength` enforced on every `<input>` and `<textarea>`
- **CORS** — the widget embed should be served with strict `Access-Control-Allow-Origin` headers
- **API key auth** — every widget request should include an `X-API-Key` header validated server-side
- **Domain whitelisting** — reject requests from origins not in your allowed-domains list
- **TLS + AES-256** — enforce HTTPS; encrypt conversation data at rest in your DB
- **GDPR** — implement a `/api/delete-visitor` endpoint that purges all messages and PII for a given visitor ID

---

## Licence

MIT — free to use and modify for personal and commercial projects.
