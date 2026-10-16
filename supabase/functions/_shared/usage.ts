/** Usage metering and plan quotas. */
import { chatCost, embeddingCost } from './ai/catalog.ts'
import type { Db } from './db.ts'
import { paymentRequired } from './http.ts'

export interface UsageRecord {
  workspaceId: string
  botId: string | null
  kind: 'chat' | 'embedding' | 'analysis' | 'eval' | 'finetune'
  provider: string
  model: string
  input: number
  output: number
  platformKey: boolean
  /** 1 when this call answered a user's message (counts toward the plan). */
  messages?: number
}

/** Fire-and-forget; usage must never break an answer. */
export function recordUsage(db: Db, u: UsageRecord): Promise<void> {
  const cost = u.kind === 'embedding' ? embeddingCost(u.model, u.input) : chatCost(u.model, u.input, u.output)
  return Promise.resolve(
    db.rpc('record_usage', {
      p_workspace: u.workspaceId,
      p_bot: u.botId,
      p_kind: u.kind,
      p_provider: u.provider,
      p_model: u.model,
      p_input: u.input,
      p_output: u.output,
      p_cost: cost,
      p_platform: u.platformKey,
      p_messages: u.messages ?? 0,
    }),
  ).then(({ error }) => {
    if (error) console.error('record_usage failed', error.message)
  })
}

export async function assertMessageQuota(db: Db, workspaceId: string): Promise<void> {
  const { data, error } = await db.rpc('message_quota', { p_workspace: workspaceId })
  if (error) {
    console.error('message_quota failed', error.message)
    return // fail open: don't block conversations on a metering error
  }
  if (data && data.allowed === false) {
    throw paymentRequired(`This workspace has used its ${data.limit} messages for the month.`)
  }
}
