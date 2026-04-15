import { generateId } from './helpers.js'

function makeApiKey() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return 'bdk_live_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const DEFAULT_APPS = [
  {
    id: 'app_ecommerce',
    name: 'E-Commerce Store',
    url: 'https://mystore.example.com',
    apiKey: 'bdk_live_a1b2c3d4e5f6a7b8c9d0e1f2',
    primaryColor: '#7c6df8',
    botName: 'Store Assistant',
    welcomeMessage: 'Hi! How can I help you shop today?',
    position: 'bottom-right',
    active: true,
    createdAt: new Date('2024-01-15'),
    knowledgeBase: [
      {
        id: 'kb_ec_shipping',
        keywords: ['shipping', 'delivery', 'ship', 'arrive', 'when will', 'how long'],
        answer: 'We ship within 1–2 business days. Standard delivery takes 5–7 days; express takes 2–3 days. Orders over $50 qualify for free standard shipping.',
        active: true,
        tags: ['shipping'],
      },
      {
        id: 'kb_ec_returns',
        keywords: ['return', 'refund', 'exchange', 'money back', 'send back'],
        answer: 'We accept returns within 30 days of purchase. Items must be unused and in original packaging. Refunds are issued within 5–7 business days of receiving your return.',
        active: true,
        tags: ['returns'],
      },
      {
        id: 'kb_ec_payment',
        keywords: ['payment', 'pay', 'card', 'visa', 'mastercard', 'paypal', 'apple pay'],
        answer: 'We accept Visa, Mastercard, American Express, PayPal, and Apple Pay. All payments are processed securely through Stripe.',
        active: true,
        tags: ['payment'],
      },
      {
        id: 'kb_ec_track',
        keywords: ['track', 'tracking', 'order status', 'where is my order', 'find order'],
        answer: 'You can track your order using the link in your shipping confirmation email, or visit our Track Order page and enter your order number.',
        active: true,
        tags: ['shipping', 'orders'],
      },
    ],
  },
  {
    id: 'app_saas',
    name: 'SaaS Dashboard',
    url: 'https://app.mysaas.example.com',
    apiKey: 'bdk_live_f0e1d2c3b4a596e7d8c9b0a1',
    primaryColor: '#10b981',
    botName: 'Support Bot',
    welcomeMessage: 'Hello! Need help with the platform?',
    position: 'bottom-right',
    active: true,
    createdAt: new Date('2024-02-20'),
    knowledgeBase: [
      {
        id: 'kb_saas_pricing',
        keywords: ['pricing', 'cost', 'plan', 'subscription', 'how much', 'tier'],
        answer: 'Our plans start at $29/month (Starter — up to 500 conversations), $79/month (Growth — up to 2,000), and $199/month (Pro — unlimited). All plans include a 14-day free trial, no credit card required.',
        active: true,
        tags: ['pricing'],
      },
      {
        id: 'kb_saas_api',
        keywords: ['api', 'integration', 'webhook', 'developer', 'sdk', 'rest', 'endpoint'],
        answer: 'We offer a full REST API and webhook support. API keys are available under Settings → API Keys. Rate limits vary by plan (100 req/min Starter, 500 Growth, unlimited Pro). Full docs at docs.mysaas.example.com.',
        active: true,
        tags: ['api', 'developer'],
      },
      {
        id: 'kb_saas_trial',
        keywords: ['trial', 'free', 'try', 'demo', 'test', 'no credit card'],
        answer: 'Yes! Every plan includes a 14-day free trial with full feature access — no credit card needed. After the trial, you choose the plan that fits your usage.',
        active: true,
        tags: ['pricing', 'trial'],
      },
    ],
  },
]

export function createApp(data) {
  return {
    id: 'app_' + generateId(),
    name: data.name || 'New App',
    url: data.url || '',
    apiKey: makeApiKey(),
    primaryColor: data.primaryColor || '#7c6df8',
    botName: data.botName || 'AI Assistant',
    welcomeMessage: data.welcomeMessage || 'Hi! How can I help you today?',
    position: 'bottom-right',
    active: true,
    createdAt: new Date(),
    knowledgeBase: [],
  }
}
