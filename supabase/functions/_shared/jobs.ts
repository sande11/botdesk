/** Background job plumbing shared by the worker and its handlers. */
import type { Db } from './db.ts'

export interface Job {
  id: number
  workspace_id: string | null
  kind: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

/** An error that retrying will not fix (bad file, 404, missing setting). */
export class PermanentError extends Error {}

/** Returned by a handler that saved its progress and wants to continue. */
export interface Deferred {
  defer: Record<string, unknown>
  delaySeconds?: number
}

export type JobResult = void | Deferred

export async function enqueue(
  db: Db,
  workspaceId: string | null,
  kind: string,
  payload: Record<string, unknown>,
  opts: { delaySeconds?: number; priority?: number } = {},
): Promise<void> {
  const { error } = await db.rpc('enqueue_job', {
    p_workspace: workspaceId,
    p_kind: kind,
    p_payload: payload,
    p_delay: `${opts.delaySeconds ?? 0} seconds`,
    p_priority: opts.priority ?? 0,
  })
  if (error) throw new Error(`enqueue ${kind} failed: ${error.message}`)
}

/** Wall-clock budget for one worker run (Edge Functions stop at 150-400 s). */
export class Budget {
  private start = Date.now()
  constructor(private ms: number) {}
  get left() {
    return this.ms - (Date.now() - this.start)
  }
  get spent() {
    return this.left <= 0
  }
}
