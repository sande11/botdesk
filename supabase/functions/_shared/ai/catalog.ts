/**
 * Built-in models offered in the dashboard, with list prices (USD per
 * million tokens) used for usage estimates. Edit this list when providers
 * release or retire models; bots keep whatever id they were saved with.
 *
 * Checked October 2026:
 *   Claude:  https://platform.claude.com/docs/en/models/overview
 *   OpenAI:  https://developers.openai.com/api/docs/models
 *   Voyage:  https://docs.voyageai.com/embeddings/
 */
import type { ChatProvider, EmbeddingProvider } from './types.ts'

export interface ChatModelInfo {
  provider: ChatProvider
  id: string
  label: string
  tier: 'fast' | 'balanced' | 'best'
  inputPerM: number | null
  outputPerM: number | null
  note?: string
}

export interface EmbeddingModelInfo {
  provider: EmbeddingProvider
  id: string
  label: string
  perM: number | null
  note?: string
}

export const CHAT_MODELS: ChatModelInfo[] = [
  { provider: 'anthropic', id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', tier: 'fast', inputPerM: 0.1, outputPerM: 0.5,
    note: 'Fastest and cheapest. Good default for support bots.' },
  { provider: 'anthropic', id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'balanced', inputPerM: 2, outputPerM: 10,
    note: 'Speed and quality. Good default for legal answers.' },
  { provider: 'anthropic', id: 'claude-opus-5-5', label: 'Claude Opus 5.5', tier: 'best', inputPerM: 4, outputPerM: 20,
    note: 'Most careful answers; slower.' },
  { provider: 'openai', id: 'gpt-6-luna', label: 'GPT-6 Luna', tier: 'fast', inputPerM: 0.1, outputPerM: 0.5 },
  { provider: 'openai', id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', tier: 'balanced', inputPerM: 2, outputPerM: 10 },
  { provider: 'openai', id: 'gpt-6-astra', label: 'GPT-6 Astra', tier: 'best', inputPerM: 10, outputPerM: 50 },
]

export const EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  { provider: 'openai', id: 'text-embedding-3-small', label: 'OpenAI text-embedding-3-small', perM: 0.02,
    note: 'Cheap general-purpose default.' },
  { provider: 'openai', id: 'text-embedding-3-large', label: 'OpenAI text-embedding-3-large', perM: 0.13 },
  { provider: 'voyage', id: 'voyage-law-2', label: 'Voyage law-2', perM: null,
    note: 'Tuned for legal text. Recommended for legal knowledge bases.' },
  { provider: 'voyage', id: 'voyage-4', label: 'Voyage 4', perM: null },
  { provider: 'voyage', id: 'voyage-4-lite', label: 'Voyage 4 lite', perM: null },
]

/** Model for internal steps: rewriting follow-up questions, transcript triage. */
export const UTILITY_MODEL = { provider: 'anthropic' as const, model: 'claude-haiku-5-5' }
export const DEFAULT_CHAT_MODEL = { provider: 'anthropic' as const, model: 'claude-haiku-5-5' }
export const DEFAULT_LEGAL_MODEL = { provider: 'anthropic' as const, model: 'claude-sonnet-5-5' }

export function chatCost(model: string, input: number, output: number): number {
  const info = CHAT_MODELS.find((m) => m.id === model)
  if (!info || info.inputPerM == null || info.outputPerM == null) return 0
  return (input * info.inputPerM + output * info.outputPerM) / 1_000_000
}

export function embeddingCost(model: string, tokens: number): number {
  const info = EMBEDDING_MODELS.find((m) => m.id === model)
  if (!info || info.perM == null) return 0
  return (tokens * info.perM) / 1_000_000
}
