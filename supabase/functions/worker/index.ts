/**
 * Background worker. pg_cron calls it every minute and enqueue_job() nudges
 * it when work arrives (see migrations 000300 and 000700). It answers at
 * once and works through the queue in the background for up to ~2 minutes.
 *
 * Auth: header x-worker-secret must equal the WORKER_SECRET env var.
 */
import { timingSafeEqual } from '../_shared/crypto.ts'
import { deliverAgentMessage } from '../_shared/channels/inbound.ts'
import { type Db, must, serviceDb } from '../_shared/db.ts'
import { env } from '../_shared/env.ts'
import { runEval } from '../_shared/evals/run.ts'
import { json } from '../_shared/http.ts'
import { ingestSource } from '../_shared/ingest/pipeline.ts'
import { Budget, enqueue, type Job, type JobResult, PermanentError } from '../_shared/jobs.ts'
import { notifyHandoff } from '../_shared/notify.ts'
import { background, log } from '../_shared/runtime.ts'
import { buildTrainingFile, ftProvider, MIN_EXAMPLES } from '../_shared/training/finetune.ts'

type Handler = (db: Db, job: Job, budget: Budget) => Promise<JobResult>

const HANDLERS: Record<string, Handler> = {
  ingest_source: ingestSource,
  eval_run: runEval,
  deliver_message: async (db, job) => {
    try {
      await deliverAgentMessage(db, String(job.payload.message_id))
    } catch (err) {
      if (job.attempts >= job.max_attempts) {
        await db.from('messages').update({ delivery_status: 'failed', delivery_error: String((err as Error).message).slice(0, 500) })
          .eq('id', String(job.payload.message_id))
      }
      throw err
    }
  },
  notify_handoff: async (db, job) => {
    await notifyHandoff(db, String(job.payload.conversation_id))
  },
  delete_file: async (db, job) => {
    const path = String(job.payload.path ?? '')
    if (job.payload.bucket !== 'sources' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(path)) {
      throw new PermanentError('Refusing to delete an unexpected path.')
    }
    const { error } = await db.storage.from('sources').remove([path])
    if (error && !/not.?found/i.test(error.message)) throw new Error(error.message)
  },
  finetune_submit: finetuneSubmit,
  finetune_poll: finetunePoll,
}

const BATCH = 3
const WORKER_ID = crypto.randomUUID().slice(0, 8)

async function drain(db: Db, budget: Budget) {
  let processed = 0
  while (!budget.spent && budget.left > 20_000) {
    const { data: jobs, error } = await db.rpc('claim_jobs', { p_worker: WORKER_ID, p_limit: BATCH, p_kinds: null })
    if (error) {
      log('error', 'claim_jobs failed', { error: error.message })
      return processed
    }
    if (!jobs?.length) return processed
    await Promise.all((jobs as Job[]).map((job) => runOne(db, job, budget)))
    processed += jobs.length
  }
  return processed
}

async function runOne(db: Db, job: Job, budget: Budget) {
  const handler = HANDLERS[job.kind]
  const t0 = Date.now()
  if (!handler) {
    await db.rpc('fail_job', { p_id: job.id, p_error: `No handler for ${job.kind}`, p_retry: false })
    return
  }
  try {
    const result = await handler(db, job, budget)
    if (result && 'defer' in result) {
      await db.rpc('defer_job', { p_id: job.id, p_payload: result.defer, p_delay: `${result.delaySeconds ?? 1} seconds` })
      log('info', 'job deferred', { id: job.id, kind: job.kind, ms: Date.now() - t0 })
    } else {
      await db.rpc('finish_job', { p_id: job.id })
      log('info', 'job done', { id: job.id, kind: job.kind, ms: Date.now() - t0 })
    }
  } catch (err) {
    const permanent = err instanceof PermanentError
    const { data: state } = await db.rpc('fail_job', { p_id: job.id, p_error: String((err as Error)?.message ?? err), p_retry: !permanent })
    log(permanent ? 'warn' : 'error', 'job failed', { id: job.id, kind: job.kind, state, error: String((err as Error)?.message) })
  }
}

// ── Fine-tuning ───────────────────────────────────────────────────────────

async function finetuneSubmit(db: Db, job: Job): Promise<JobResult> {
  const id = String(job.payload.finetune_job_id)
  const ft = await must(db.from('finetune_jobs').select('*').eq('id', id).maybeSingle())
  if (!ft || ft.status !== 'queued' && ft.status !== 'uploading') return
  const fail = async (msg: string) => {
    await must(db.from('finetune_jobs').update({ status: 'failed', error: msg, finished_at: new Date().toISOString() }).eq('id', id))
  }
  try {
    const { jsonl, count } = await buildTrainingFile(db, ft.dataset_id)
    if (count < MIN_EXAMPLES) {
      await fail(`The dataset has ${count} usable examples; at least ${MIN_EXAMPLES} are needed (50+ recommended).`)
      return
    }
    await must(db.from('finetune_jobs').update({ status: 'uploading', example_count: count }).eq('id', id))
    const provider = await ftProvider(db, ft.workspace_id, ft.provider)
    const fileId = await provider.upload(jsonl, `botdesk-${id}.jsonl`)
    const providerJobId = await provider.create(fileId, ft.base_model, ft.suffix, ft.hyperparameters ?? {})
    await must(db.from('finetune_jobs').update({
      status: 'submitted', provider_file_id: fileId, provider_job_id: providerJobId, error: null,
    }).eq('id', id))
    await enqueue(db, ft.workspace_id, 'finetune_poll', { finetune_job_id: id }, { delaySeconds: 60 })
  } catch (err) {
    if (err instanceof PermanentError || job.attempts >= job.max_attempts) await fail((err as Error).message)
    throw err
  }
}

async function finetunePoll(db: Db, job: Job): Promise<JobResult> {
  const id = String(job.payload.finetune_job_id)
  const ft = await must(db.from('finetune_jobs').select('*').eq('id', id).maybeSingle())
  if (!ft || !ft.provider_job_id || ['succeeded', 'failed', 'cancelled'].includes(ft.status)) return
  const provider = await ftProvider(db, ft.workspace_id, ft.provider)
  const r = await provider.poll(ft.provider_job_id)

  if (r.status === 'succeeded' && r.model) {
    await must(db.from('finetune_jobs').update({
      status: 'succeeded', result_model: r.model, finished_at: new Date().toISOString(),
    }).eq('id', id))
    const { data: cred } = await db.from('provider_credentials').select('id')
      .eq('workspace_id', ft.workspace_id).eq('provider', ft.provider).order('created_at').limit(1)
    await db.from('custom_models').upsert({
      workspace_id: ft.workspace_id,
      provider: ft.provider,
      model: r.model,
      label: `Fine-tuned ${ft.base_model}${ft.suffix ? ` (${ft.suffix})` : ''}`,
      credential_id: cred?.[0]?.id ?? null,
      origin: 'finetune',
      finetune_job_id: id,
    }, { onConflict: 'workspace_id,provider,model' })
    return
  }
  if (r.status === 'failed' || r.status === 'cancelled') {
    await must(db.from('finetune_jobs').update({
      status: r.status, error: r.error ?? null, finished_at: new Date().toISOString(),
    }).eq('id', id))
    return
  }
  if (r.status !== ft.status) await must(db.from('finetune_jobs').update({ status: r.status }).eq('id', id))
  await enqueue(db, ft.workspace_id, 'finetune_poll', { finetune_job_id: id }, { delaySeconds: 120 })
}

// ── HTTP ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const secret = env('WORKER_SECRET')
  const given = req.headers.get('x-worker-secret') ?? ''
  if (!secret || !timingSafeEqual(given, secret)) {
    return json({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401)
  }
  const db = serviceDb()
  // A run gets ~2 minutes; cron starts the next one every minute, and jobs
  // are claimed with SKIP LOCKED, so overlapping runs are safe.
  const budget = new Budget(Number(env('WORKER_BUDGET_MS') ?? 120_000))
  const work = drain(db, budget).then((n) => n && log('info', 'worker run', { processed: n }))
  if (new URL(req.url).searchParams.get('wait') === '1') {
    await work
    return json({ ok: true })
  }
  background(work)
  return json({ ok: true, accepted: true }, 202)
})
