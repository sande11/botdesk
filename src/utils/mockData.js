/**
 * Mock data for the admin dashboard demo.
 * Replace with real API calls to your backend.
 */

export const MOCK_CONVERSATIONS = [
  {
    id: 'c1',
    appId: 'app_saas',
    visitorId: 'vis_x92k',
    visitorName: 'Sarah M.',
    visitorEmail: 'sarah.m@example.com',
    status: 'resolved',
    channel: 'web',
    startedAt: new Date(Date.now() - 86400000 * 2),
    lastMessage: new Date(Date.now() - 86400000 * 2 + 3600000),
    messages: [
      { id: 'm1', role: 'user', content: 'Hi, what are your pricing plans?',                                     ts: new Date(Date.now() - 86400000 * 2) },
      { id: 'm2', role: 'bot',  content: 'Our plans start at $29/month for Starter (up to 500 conversations), $79/month for Growth, and $199/month for Pro (unlimited). All plans include a 14-day free trial!', ts: new Date(Date.now() - 86400000 * 2 + 10000) },
      { id: 'm3', role: 'user', content: 'Can I get a refund if it doesn\'t work for me?',                      ts: new Date(Date.now() - 86400000 * 2 + 20000) },
      { id: 'm4', role: 'bot',  content: 'We offer a full refund within 30 days of purchase, no questions asked. To cancel, go to Settings → Billing → Cancel Subscription.',                                     ts: new Date(Date.now() - 86400000 * 2 + 30000) },
    ],
    escalated: false,
    tags: ['pricing', 'refund'],
  },
  {
    id: 'c2',
    appId: 'app_saas',
    visitorId: 'vis_m33t',
    visitorName: 'James K.',
    visitorEmail: 'james.k@company.io',
    status: 'escalated',
    channel: 'web',
    startedAt: new Date(Date.now() - 3600000 * 5),
    lastMessage: new Date(Date.now() - 3600000 * 2),
    messages: [
      { id: 'm5', role: 'user',       content: 'Do you support custom enterprise contracts with SLA guarantees?',                                                                    ts: new Date(Date.now() - 3600000 * 5) },
      { id: 'm6', role: 'bot',        content: "That's a great question! I don't have the full details on enterprise contracts. Let me connect you with our team — they'll follow up via email within 2 hours.", ts: new Date(Date.now() - 3600000 * 5 + 10000) },
      { id: 'm7', role: 'escalation', content: 'Escalated to human agent · james.k@company.io notified via email',                                                                  ts: new Date(Date.now() - 3600000 * 5 + 15000) },
    ],
    escalated: true,
    tags: ['enterprise', 'escalated'],
  },
  {
    id: 'c3',
    appId: 'app_ecommerce',
    visitorId: 'vis_p01z',
    visitorName: 'Amara T.',
    visitorEmail: null,
    status: 'active',
    channel: 'web',
    startedAt: new Date(Date.now() - 60000 * 8),
    lastMessage: new Date(Date.now() - 60000 * 2),
    messages: [
      { id: 'm8',  role: 'user', content: 'How do I integrate this with my Framer site?',                                                                                                  ts: new Date(Date.now() - 60000 * 8) },
      { id: 'm9',  role: 'bot',  content: 'We support Framer, Webflow, WordPress, Shopify, and any custom HTML site. Simply paste one <script> tag into your site — no coding required!', ts: new Date(Date.now() - 60000 * 8 + 8000) },
      { id: 'm10', role: 'user', content: 'Is there a video tutorial for the Framer setup?',                                                                                               ts: new Date(Date.now() - 60000 * 4) },
      { id: 'm11', role: 'bot',  content: "Great question! I don't have a video tutorial link in my knowledge base right now. Let me connect you with someone who can help directly.",      ts: new Date(Date.now() - 60000 * 4 + 8000) },
    ],
    escalated: false,
    tags: ['integration', 'framer'],
  },
  {
    id: 'c4',
    appId: 'app_saas',
    visitorId: 'vis_q77w',
    visitorName: 'Luca B.',
    visitorEmail: 'luca@startup.io',
    status: 'resolved',
    channel: 'web',
    startedAt: new Date(Date.now() - 86400000),
    lastMessage: new Date(Date.now() - 86400000 + 1800000),
    messages: [
      { id: 'm12', role: 'user', content: 'Is there a free trial?',          ts: new Date(Date.now() - 86400000) },
      { id: 'm13', role: 'bot',  content: 'Yes! Every plan includes a 14-day free trial with full access to all features — no credit card needed. After the trial, choose a plan that fits your usage.', ts: new Date(Date.now() - 86400000 + 8000) },
      { id: 'm14', role: 'user', content: 'How do I sign up?',               ts: new Date(Date.now() - 86400000 + 60000) },
      { id: 'm15', role: 'bot',  content: 'Getting started takes under 5 minutes: 1) Upload your knowledge base docs, 2) Customise the widget, 3) Copy the embed script to your website.', ts: new Date(Date.now() - 86400000 + 70000) },
    ],
    escalated: false,
    tags: ['trial', 'setup'],
  },
  {
    id: 'c5',
    appId: 'app_ecommerce',
    visitorId: 'vis_n55r',
    visitorName: 'Priya S.',
    visitorEmail: 'priya@techcorp.com',
    status: 'resolved',
    channel: 'web',
    startedAt: new Date(Date.now() - 86400000 * 3),
    lastMessage: new Date(Date.now() - 86400000 * 3 + 900000),
    messages: [
      { id: 'm16', role: 'user', content: 'Do you have GDPR compliance?',    ts: new Date(Date.now() - 86400000 * 3) },
      { id: 'm17', role: 'bot',  content: "All conversations are encrypted in transit (TLS 1.3) and at rest (AES-256). We're GDPR compliant and SOC 2 Type II certified. Your data is never used to train third-party AI models.", ts: new Date(Date.now() - 86400000 * 3 + 8000) },
    ],
    escalated: false,
    tags: ['security', 'compliance'],
  },
]

export const DASHBOARD_STATS = [
  { label: 'Total Conversations', value: '1,284', delta: '+12%', up: true,  icon: '💬' },
  { label: 'Resolved by AI',      value: '89%',   delta: '+3%',  up: true,  icon: '🤖' },
  { label: 'Avg. Response Time',  value: '1.2s',  delta: '-0.3s', up: true, icon: '⚡' },
  { label: 'Escalated',           value: '142',   delta: '+5%',  up: false, icon: '⚠' },
]

export const DAILY_VOLUME = [
  { day: 'Mon', count: 68 },
  { day: 'Tue', count: 84 },
  { day: 'Wed', count: 92 },
  { day: 'Thu', count: 71 },
  { day: 'Fri', count: 110 },
  { day: 'Sat', count: 45 },
  { day: 'Sun', count: 38 },
]

export const TOP_TOPICS = [
  { label: 'Pricing & plans',  pct: 34 },
  { label: 'Integrations',     pct: 22 },
  { label: 'Refund policy',    pct: 17 },
  { label: 'Setup & install',  pct: 13 },
  { label: 'API / Developers', pct: 9  },
  { label: 'Other',            pct: 5  },
]
