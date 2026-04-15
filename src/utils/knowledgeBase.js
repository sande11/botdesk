/**
 * Knowledge Base — RAG-style lookup engine
 *
 * In production: replace findAnswer() with a call to your backend
 * vector-search API (e.g. Supabase pgvector, Pinecone, Weaviate).
 *
 * The backend flow would be:
 *   1. Embed the user query  → POST /api/embed
 *   2. Vector similarity search against your stored embeddings
 *   3. Return top-k matching chunks
 *   4. Send chunks + query to Claude/GPT to synthesise an answer
 */

export const DEFAULT_KNOWLEDGE_BASE = [
  {
    id: 'kb_pricing',
    keywords: ['pricing', 'cost', 'price', 'how much', 'plan', 'subscription', 'tier'],
    answer:
      'Our plans start at $29/month for Starter (up to 500 conversations), $79/month for Growth (up to 2,000), and $199/month for Pro (unlimited). All plans include a 14-day free trial with no credit card required.',
    tags: ['pricing'],
  },
  {
    id: 'kb_refund',
    keywords: ['refund', 'cancel', 'money back', 'cancellation'],
    answer:
      'We offer a full refund within 30 days of purchase, no questions asked. To cancel, go to Settings → Billing → Cancel Subscription. You keep access until the end of your billing period.',
    tags: ['billing'],
  },
  {
    id: 'kb_integration',
    keywords: ['integration', 'connect', 'framer', 'wordpress', 'webflow', 'shopify', 'embed', 'install'],
    answer:
      'We support Framer, Webflow, WordPress, Shopify, and any custom HTML site. Simply paste one <script> tag into your site — no coding required. Full step-by-step guides are in the Embed & Deploy section of your dashboard.',
    tags: ['integration', 'setup'],
  },
  {
    id: 'kb_escalation',
    keywords: ['whatsapp', 'email', 'escalate', 'human', 'agent', 'person', 'team', 'support'],
    answer:
      "When I can't answer a question, I'll automatically offer to connect you with a human agent via email or WhatsApp. Response times are typically under 2 hours during business hours (Mon–Fri, 9am–6pm UTC).",
    tags: ['support', 'escalation'],
  },
  {
    id: 'kb_security',
    keywords: ['data', 'privacy', 'gdpr', 'security', 'secure', 'encryption', 'safe', 'compliance'],
    answer:
      "All conversations are encrypted in transit (TLS 1.3) and at rest (AES-256). We're GDPR compliant and SOC 2 Type II certified. Your data is never used to train third-party AI models. You can request data deletion at any time.",
    tags: ['security', 'privacy'],
  },
  {
    id: 'kb_setup',
    keywords: ['setup', 'start', 'how to', 'begin', 'onboard', 'getting started', 'quick start'],
    answer:
      'Getting started takes under 5 minutes: 1) Upload your knowledge base documents in the dashboard, 2) Customise the widget colours and messages, 3) Copy the embed script to your website. Our onboarding wizard guides you through each step.',
    tags: ['setup'],
  },
  {
    id: 'kb_api',
    keywords: ['api', 'developer', 'webhook', 'custom', 'rest', 'sdk', 'endpoint'],
    answer:
      'We offer a full REST API and webhook support. API keys are available under Settings → Developers. Rate limits: 100 req/min on Starter, 500 on Growth, unlimited on Pro. API docs are at docs.botdesk.io.',
    tags: ['api', 'developer'],
  },
  {
    id: 'kb_languages',
    keywords: ['language', 'languages', 'multilingual', 'spanish', 'french', 'arabic', 'portuguese'],
    answer:
      'The chatbot supports 40+ languages automatically. It detects the visitor\'s language and responds accordingly. You can also force a specific language per widget in Settings → Widget → Language.',
    tags: ['languages'],
  },
  {
    id: 'kb_trial',
    keywords: ['trial', 'free', 'try', 'demo', 'test'],
    answer:
      'Yes! Every plan includes a 14-day free trial with full access to all features — no credit card needed. After the trial, choose a plan that fits your usage.',
    tags: ['pricing', 'trial'],
  },
]

/**
 * Find the best matching answer for a user message.
 * Returns { answer: string, entry: object } or null if no match.
 *
 * @param {string} message - raw user message
 * @param {Array}  kb      - knowledge base array (defaults to DEFAULT_KNOWLEDGE_BASE)
 */
export function findAnswer(message, kb = DEFAULT_KNOWLEDGE_BASE) {
  if (!message || typeof message !== 'string') return null
  if (!Array.isArray(kb) || kb.length === 0) return null

  const lower = message.toLowerCase().trim()

  let bestMatch = null
  let bestScore = 0

  for (const entry of kb) {
    if (entry.active !== false) { // treat missing `active` as true; skip explicitly disabled entries
      const score = entry.keywords.reduce((acc, kw) => {
        if (lower.includes(kw.toLowerCase())) {
          // Longer keyword matches score higher (more specific)
          return acc + kw.length
        }
        return acc
      }, 0)
      if (score > bestScore) {
        bestScore = score
        bestMatch = entry
      }
    }
  }

  return bestMatch ? { answer: bestMatch.answer, entry: bestMatch } : null
}
