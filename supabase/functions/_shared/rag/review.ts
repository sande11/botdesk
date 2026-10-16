/**
 * Review queue: answers a person should look at. An answer goes to review
 * when the bot found nothing (a knowledge gap), when confidence is low, or
 * at random (settings.review_sample_rate) for spot checks.
 *
 * Legal workspaces (a lawyer checks answers) sample 10% by default; others
 * queue gaps and low confidence, and sample only if a rate is set.
 * settings.review_queue = false turns automatic review off.
 */
import type { BotContext } from '../conversations.ts'
import type { Db } from '../db.ts'
import type { AnswerResult } from './answer.ts'
import { legalMode } from './answer.ts'

export async function maybeQueueReview(
  db: Db,
  ctx: BotContext,
  opts: { conversationId: string; messageId: string; question: string; result: AnswerResult },
): Promise<void> {
  const legal = legalMode(ctx)
  if (ctx.workspace.settings?.review_queue === false) return
  if (legal && ctx.bot.legal?.review_low_confidence === false) return
  const r = opts.result
  const rate = Number(ctx.workspace.settings?.review_sample_rate ?? (legal ? 0.1 : 0))
  const reason = r.outcome === 'no_answer'
    ? 'no_answer'
    : r.confidence < 0.55
    ? 'low_confidence'
    : Math.random() < rate
    ? 'sampled'
    : null
  if (!reason) return
  const { error } = await db.from('review_items').insert({
    workspace_id: ctx.workspace.id,
    bot_id: ctx.bot.id,
    conversation_id: opts.conversationId,
    message_id: opts.messageId,
    question: opts.question.slice(0, 4000),
    answer: r.text.slice(0, 8000),
    citations: r.citations,
    jurisdiction: r.jurisdiction,
    reason,
  })
  if (error && error.code !== '23505') console.error('review insert failed', error.message)
}
