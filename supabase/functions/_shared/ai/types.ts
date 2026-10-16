export type ChatProvider = 'anthropic' | 'openai' | 'together' | 'openai_compatible' | 'mock'
export type EmbeddingProvider = 'openai' | 'voyage' | 'mock'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** What a call is for. Only the mock model reads it; real models use the prompt. */
export interface TaskHint {
  task: 'answer' | 'legal_answer' | 'condense' | 'analyze_transcript' | 'summarize' | 'judge'
  question?: string
  sources?: { n: number; title: string; content: string; citation?: string | null }[]
  extra?: Record<string, unknown>
}

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  maxTokens: number
  temperature?: number | null
  /** Ask for a single JSON object as the reply. */
  json?: boolean
  hint?: TaskHint
  signal?: AbortSignal
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface ChatResult {
  text: string
  usage: Usage
  provider: ChatProvider
  model: string
}

export interface ChatModel {
  provider: ChatProvider
  model: string
  /** True when the platform's key (not the workspace's) pays for the call. */
  platformKey: boolean
  complete(req: ChatRequest): Promise<ChatResult>
  /** Streams text deltas to `onDelta`, then resolves with the full result. */
  stream(req: ChatRequest, onDelta: (text: string) => void): Promise<ChatResult>
}

export interface EmbeddingModel {
  provider: EmbeddingProvider
  model: string
  platformKey: boolean
  dims: 1024
  embed(texts: string[], kind: 'query' | 'document'): Promise<{ vectors: number[][]; tokens: number }>
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string,
    public retryable = false,
  ) {
    super(message)
  }
}
