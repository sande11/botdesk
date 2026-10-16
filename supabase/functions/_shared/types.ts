/** Row shapes the functions read. Mirrors supabase/migrations. */
import type { ChatProvider } from './ai/types.ts'

export type Channel = 'web' | 'api' | 'whatsapp' | 'sms'

export interface WorkspaceRow {
  id: string
  name: string
  slug: string
  plan: string
  features: { legal?: boolean } & Record<string, unknown>
  settings: {
    retention_days?: number
    jurisdictions?: string[]
    default_jurisdiction?: string
    review_sample_rate?: number
    review_queue?: boolean
    notify_email?: string
    allow_platform_ai?: boolean
  } & Record<string, unknown>
}

export interface AnswerPolicy {
  top_k?: number
  min_score?: number
  citations?: 'required' | 'optional' | 'off'
  on_no_answer?: 'handoff' | 'message'
  fallback_message?: string
  allow_general_knowledge?: boolean
  history_turns?: number
}

export interface LegalSettings {
  enabled?: boolean
  answer_format?: 'legal' | 'text'
  default_jurisdiction?: string
  disclaimer?: string
  review_low_confidence?: boolean
}

export interface WidgetSettings {
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

export interface BotRow {
  id: string
  workspace_id: string
  name: string
  description: string
  status: 'draft' | 'live' | 'paused'
  instructions: string
  model: { provider: ChatProvider; model: string; max_tokens?: number; temperature?: number | null; custom_model_id?: string | null }
  answer_policy: AnswerPolicy
  legal: LegalSettings
  handoff: { enabled?: boolean; email?: string; message?: string }
  widget: WidgetSettings
  allowed_domains: string[]
  rate_limit_per_min: number
}

export interface KnowledgeBaseRow {
  id: string
  workspace_id: string
  name: string
  embedding_provider: 'openai' | 'voyage' | 'mock'
  embedding_model: string
  chunk_tokens: number
  chunk_overlap: number
  legal: boolean
}

export interface ConversationRow {
  id: string
  workspace_id: string
  bot_id: string
  contact_id: string
  channel: Channel
  status: 'open' | 'handoff' | 'resolved'
  bot_channel_id: string | null
  jurisdiction: string | null
  metadata: Record<string, unknown>
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

export interface LegalAnswer {
  summary: string
  points: string[]
  /** LegAI's LegalSource: title "Employment Act · s. 29", detail = heading/snippet */
  sources: { title: string; detail: string; url: string | null; n: number }[]
  follow_ups: string[]
  see_a_lawyer: boolean
  disclaimer: string
}
