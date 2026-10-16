/** Row shapes the dashboard reads (see supabase/migrations). */

export type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer'
export const ROLE_RANK: Record<Role, number> = { owner: 50, admin: 40, editor: 30, reviewer: 20, viewer: 10 }
export const ROLE_INFO: Record<Role, string> = {
  owner: 'Everything, including deleting the workspace',
  admin: 'Members, API keys, model keys and channels',
  editor: 'Bots, knowledge, training and evals',
  reviewer: 'Reply in the inbox and review answers',
  viewer: 'Read only',
}

export interface Plan {
  id: string
  name: string
  price_cents: number
  limits: {
    messages_per_month: number | null
    bots: number | null
    sources: number | null
    storage_mb: number | null
    members: number | null
    platform_ai: boolean
  }
  sort: number
}

export interface Workspace {
  id: string
  name: string
  slug: string
  plan: string
  features: { legal?: boolean }
  settings: {
    retention_days?: number
    jurisdictions?: string[]
    default_jurisdiction?: string
    review_sample_rate?: number
    review_queue?: boolean
    notify_email?: string
    allow_platform_ai?: boolean
  }
  created_at: string
}

export interface Membership {
  workspace_id: string
  user_id: string
  role: Role
  created_at: string
  workspaces?: Workspace
}

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  avatar_url: string | null
  is_platform_admin: boolean
}

export type ChatProvider = 'anthropic' | 'openai' | 'together' | 'openai_compatible' | 'mock'

export interface Bot {
  id: string
  workspace_id: string
  name: string
  description: string
  status: 'draft' | 'live' | 'paused'
  instructions: string
  model: { provider: ChatProvider; model: string; max_tokens?: number; temperature?: number | null; custom_model_id?: string | null }
  answer_policy: {
    top_k?: number
    min_score?: number
    citations?: 'required' | 'optional' | 'off'
    on_no_answer?: 'handoff' | 'message'
    fallback_message?: string
    allow_general_knowledge?: boolean
    history_turns?: number
  }
  legal: {
    enabled?: boolean
    answer_format?: 'legal' | 'text'
    default_jurisdiction?: string
    disclaimer?: string
    review_low_confidence?: boolean
  }
  handoff: { enabled?: boolean; email?: string; message?: string }
  widget: {
    primary_color?: string
    position?: 'bottom-right' | 'bottom-left'
    title?: string
    subtitle?: string
    welcome_message?: string
    launcher_label?: string
    suggested_questions?: string[]
    show_sources?: boolean
    avatar_url?: string
  }
  allowed_domains: string[]
  rate_limit_per_min: number
  created_at: string
  updated_at: string
}

export interface KnowledgeBase {
  id: string
  workspace_id: string
  name: string
  description: string
  embedding_provider: 'openai' | 'voyage' | 'mock'
  embedding_model: string
  chunk_tokens: number
  chunk_overlap: number
  legal: boolean
  created_at: string
}

export type SourceKind = 'file' | 'url' | 'sitemap' | 'text' | 'qa'
export type SourceStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'disabled'
export const SOURCE_TYPES = [
  'statute', 'regulation', 'case_law', 'constitution', 'guidance', 'practice_note', 'form', 'faq', 'verified_answer', 'other',
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export interface Source {
  id: string
  workspace_id: string
  knowledge_base_id: string
  parent_id: string | null
  kind: SourceKind
  title: string
  url: string | null
  storage_path: string | null
  mime_type: string | null
  bytes: number | null
  content: string | null
  question: string | null
  status: SourceStatus
  error: string | null
  token_count: number
  chunk_count: number
  progress: { phase?: string; page?: number; pages?: number; done?: number; total?: number }
  jurisdiction: string | null
  source_type: SourceType | null
  citation: string | null
  effective_date: string | null
  superseded: boolean
  metadata: Record<string, unknown>
  refresh_hours: number | null
  last_indexed_at: string | null
  created_at: string
  updated_at: string
}

export interface Chunk {
  id: string
  ordinal: number
  content: string
  heading: string
  section: string | null
  token_count: number
}

export type Channel = 'web' | 'api' | 'whatsapp' | 'sms'

export interface Contact {
  id: string
  channel: Channel
  external_id: string
  name: string | null
  email: string | null
  phone: string | null
  metadata: Record<string, unknown>
}

export interface Conversation {
  id: string
  workspace_id: string
  bot_id: string
  contact_id: string
  channel: Channel
  status: 'open' | 'handoff' | 'resolved'
  assigned_to: string | null
  title: string | null
  tags: string[]
  jurisdiction: string | null
  message_count: number
  unanswered: number
  last_message_at: string
  handoff_at: string | null
  created_at: string
  contacts?: Contact
  bots?: { name: string }
}

export interface Citation {
  n: number
  source_id: string
  chunk_id: string
  title: string
  url: string | null
  citation: string | null
  section: string | null
  snippet: string
  score: number
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'agent' | 'system'
  content: string
  citations: Citation[]
  structured: LegalAnswer | null
  outcome: 'answered' | 'no_answer' | 'handoff' | 'error' | null
  confidence: number | null
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  latency_ms: number | null
  author_id: string | null
  delivery_status: 'pending' | 'sent' | 'delivered' | 'failed' | null
  delivery_error: string | null
  created_at: string
}

export interface LegalAnswer {
  summary: string
  points: string[]
  sources: { n: number; title: string; detail: string; url: string | null }[]
  follow_ups: string[]
  see_a_lawyer: boolean
  disclaimer: string
}

export interface ApiKey {
  id: string
  workspace_id: string
  bot_id: string | null
  name: string
  kind: 'publishable' | 'secret'
  prefix: string
  /** Publishable keys only: they are public, so they can be shown again. */
  display_key: string | null
  scopes: string[]
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface ProviderCredential {
  id: string
  provider: 'anthropic' | 'openai' | 'voyage' | 'together' | 'openai_compatible'
  label: string
  base_url: string | null
  key_hint: string | null
  created_at: string
}

export interface CustomModel {
  id: string
  provider: 'openai' | 'together' | 'openai_compatible'
  model: string
  label: string
  origin: 'custom' | 'finetune'
  credential_id: string | null
  created_at: string
}

export interface ChannelRow {
  id: string
  bot_id: string
  kind: 'whatsapp' | 'twilio_sms' | 'africastalking_sms'
  name: string
  status: 'active' | 'disabled'
  config: Record<string, string | boolean>
  webhook_url: string
  verify_token?: string
  created_at: string
}

export interface ReviewItem {
  id: string
  workspace_id: string
  bot_id: string | null
  conversation_id: string | null
  message_id: string | null
  question: string
  answer: string
  citations: Citation[]
  jurisdiction: string | null
  reason: 'low_confidence' | 'negative_feedback' | 'sampled' | 'no_answer' | 'manual'
  status: 'pending' | 'approved' | 'corrected' | 'rejected'
  corrected_answer: string | null
  notes: string | null
  reviewer_id: string | null
  reviewed_at: string | null
  published_source_id: string | null
  created_at: string
}

export interface Dataset {
  id: string
  workspace_id: string
  name: string
  description: string
  system_prompt: string
  created_at: string
}

export interface DatasetExample {
  id: string
  dataset_id: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  origin: 'review' | 'feedback' | 'manual' | 'import'
  approved: boolean
  created_at: string
}

export interface FinetuneJob {
  id: string
  dataset_id: string
  provider: 'openai' | 'together'
  base_model: string
  suffix: string | null
  hyperparameters: Record<string, unknown>
  status: 'queued' | 'uploading' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  example_count: number | null
  result_model: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface EvalSet {
  id: string
  name: string
  description: string
  created_at: string
}

export interface EvalCase {
  id: string
  eval_set_id: string
  question: string
  expected_answer: string
  expected_source_ids: string[]
  should_decline: boolean
  jurisdiction: string | null
}

export interface EvalRun {
  id: string
  eval_set_id: string
  bot_id: string
  model_override: { provider: string; model: string } | null
  status: 'queued' | 'running' | 'done' | 'failed'
  metrics: {
    cases?: number
    answered_rate?: number | null
    correctness?: number | null
    faithfulness?: number | null
    citation_rate?: number | null
    source_recall?: number | null
    avg_latency_ms?: number | null
  }
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface EvalResult {
  id: string
  case_id: string
  answer: string | null
  outcome: string | null
  citations: Citation[]
  scores: { correctness?: number | null; faithfulness?: number | null; source_hit?: boolean | null; declined?: boolean; notes?: string }
  latency_ms: number | null
}

export interface UsageMonth {
  workspace_id: string
  period: string
  messages: number
  input_tokens: number
  output_tokens: number
  embedding_tokens: number
  cost_usd: number
}

export interface AuditEntry {
  id: number
  actor_id: string | null
  actor_type: string
  action: string
  target_type: string | null
  target_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

/** Playground / API answer, as returned by the answer engine. */
export interface AnswerResult {
  text: string
  outcome: 'answered' | 'no_answer'
  citations: Citation[]
  legal: LegalAnswer | null
  confidence: number
  offerHandoff: boolean
  disclaimer: string | null
  jurisdiction: string | null
  standaloneQuery: string
  retrieval: { source_id: string; title: string; section: string | null; vector_score: number | null; text_score: number | null; used: boolean }[]
  provider: string
  model: string
  usage: { inputTokens: number; outputTokens: number }
  latencyMs: number
}

export interface Flag {
  key: string
  kind: 'rights' | 'caution' | 'next_step'
  title: string
  body: string
  quote: string | null
  citation: string | null
}

export interface ModelCatalog {
  fake_ai: boolean
  providers: Record<string, { own_key: boolean; platform: boolean; available: boolean }>
  chat: { provider: ChatProvider; id: string; label: string; tier: string; inputPerM: number | null; outputPerM: number | null; note?: string; available: boolean }[]
  embedding: { provider: 'openai' | 'voyage'; id: string; label: string; perM: number | null; note?: string; available: boolean }[]
  custom: CustomModel[]
}
