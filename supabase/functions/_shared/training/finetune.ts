/**
 * Fine-tuning: builds a JSONL training file from a dataset and runs the job
 * with a provider.
 *
 * Providers (October 2026):
 *  - OpenAI: closed to new organisations since May 2026; existing users can
 *    create jobs until 6 Jan 2027. Kept for accounts that still have access.
 *  - Together AI: LoRA / full fine-tunes of open models. The result needs a
 *    dedicated endpoint to serve it; add that endpoint as a custom model.
 * Any other platform: export the JSONL from the dashboard.
 */
import { resolveCredential, TOGETHER_BASE_URL } from '../ai/registry.ts'
import { type Db, must } from '../db.ts'
import { PermanentError } from '../jobs.ts'

export const MIN_EXAMPLES = 10

export interface ExampleRow {
  messages: { role: string; content: string }[]
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g

/** Masks emails and phone numbers; training data should not carry them. */
export function scrubPii(text: string): string {
  return text.replace(EMAIL, '[email]').replace(PHONE, '[phone]')
}

export function toJsonl(systemPrompt: string, examples: ExampleRow[], opts: { scrub?: boolean } = {}): string {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const ex of examples) {
    const msgs = (ex.messages ?? [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: opts.scrub === false ? m.content.trim() : scrubPii(m.content.trim()) }))
    if (msgs.length < 2 || msgs[msgs.length - 1].role !== 'assistant' || msgs[0].role !== 'user') continue
    const key = JSON.stringify(msgs)
    if (seen.has(key)) continue
    seen.add(key)
    const all = systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.trim() }, ...msgs] : msgs
    lines.push(JSON.stringify({ messages: all }))
  }
  return lines.join('\n') + (lines.length ? '\n' : '')
}

export async function buildTrainingFile(db: Db, datasetId: string): Promise<{ jsonl: string; count: number }> {
  const ds = await must(db.from('datasets').select('id, system_prompt').eq('id', datasetId).single())
  const rows: ExampleRow[] = []
  for (let from = 0;; from += 1000) {
    const page = await must(
      db.from('dataset_examples').select('messages').eq('dataset_id', datasetId).eq('approved', true)
        .order('created_at').range(from, from + 999),
    ) as ExampleRow[]
    rows.push(...page)
    if (page.length < 1000) break
  }
  const jsonl = toJsonl(ds?.system_prompt ?? '', rows)
  const count = jsonl ? jsonl.trim().split('\n').length : 0
  return { jsonl, count }
}

export type FtStatus = 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface FtProvider {
  upload(jsonl: string, name: string): Promise<string>
  create(fileId: string, baseModel: string, suffix: string | null, hp: Record<string, unknown>): Promise<string>
  poll(jobId: string): Promise<{ status: FtStatus; model?: string | null; error?: string | null }>
}

export async function ftProvider(db: Db, workspaceId: string, provider: 'openai' | 'together'): Promise<FtProvider> {
  const cred = await resolveCredential(db, workspaceId, provider)
  if (cred.platform) {
    throw new PermanentError(`Fine-tuning uses your own ${provider === 'openai' ? 'OpenAI' : 'Together AI'} key. Add one in Settings → Models.`)
  }
  return provider === 'openai' ? openaiFt(cred.apiKey, cred.baseUrl) : togetherFt(cred.apiKey, cred.baseUrl)
}

async function check(res: Response, who: string) {
  const text = await res.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    // keep text
  }
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.message ?? String(text).slice(0, 300)
    const err = `${who} error ${res.status}: ${msg}`
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentError(err)
    throw new Error(err)
  }
  return body
}

function openaiFt(apiKey: string, baseUrl?: string): FtProvider {
  const base = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const auth = { authorization: `Bearer ${apiKey}` }
  return {
    async upload(jsonl, name) {
      const form = new FormData()
      form.append('purpose', 'fine-tune')
      form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), name)
      const j = await check(await fetch(`${base}/files`, { method: 'POST', headers: auth, body: form }), 'OpenAI')
      return j.id
    },
    async create(fileId, baseModel, suffix, hp) {
      const j = await check(
        await fetch(`${base}/fine_tuning/jobs`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: baseModel,
            training_file: fileId,
            ...(suffix ? { suffix: suffix.slice(0, 40) } : {}),
            ...(Object.keys(hp).length ? { method: { type: 'supervised', supervised: { hyperparameters: hp } } } : {}),
          }),
        }),
        'OpenAI',
      )
      return j.id
    },
    async poll(jobId) {
      const j = await check(await fetch(`${base}/fine_tuning/jobs/${jobId}`, { headers: auth }), 'OpenAI')
      const map: Record<string, FtStatus> = {
        validating_files: 'submitted', queued: 'submitted', running: 'running', succeeded: 'succeeded',
        failed: 'failed', cancelled: 'cancelled',
      }
      return { status: map[j.status] ?? 'running', model: j.fine_tuned_model ?? null, error: j.error?.message ?? null }
    },
  }
}

function togetherFt(apiKey: string, baseUrl?: string): FtProvider {
  const base = (baseUrl ?? TOGETHER_BASE_URL).replace(/\/$/, '')
  const auth = { authorization: `Bearer ${apiKey}` }
  return {
    async upload(jsonl, name) {
      const form = new FormData()
      form.append('purpose', 'fine-tune')
      form.append('file_name', name)
      form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), name)
      const j = await check(await fetch(`${base}/files/upload`, { method: 'POST', headers: auth, body: form }), 'Together')
      return j.id
    },
    async create(fileId, baseModel, suffix, hp) {
      const j = await check(
        await fetch(`${base}/fine-tunes`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            training_file: fileId,
            model: baseModel,
            n_epochs: Number(hp.n_epochs ?? 3),
            ...(suffix ? { suffix: suffix.slice(0, 64) } : {}),
            ...(hp.learning_rate ? { learning_rate: Number(hp.learning_rate) } : {}),
            training_type: { type: 'Lora', lora_r: Number(hp.lora_r ?? 16), lora_alpha: Number(hp.lora_alpha ?? 32) },
          }),
        }),
        'Together',
      )
      return j.id
    },
    async poll(jobId) {
      const j = await check(await fetch(`${base}/fine-tunes/${jobId}`, { headers: auth }), 'Together')
      const map: Record<string, FtStatus> = {
        pending: 'submitted', queued: 'submitted', running: 'running', compressing: 'running', uploading: 'running',
        cancel_requested: 'running', cancelled: 'cancelled', error: 'failed', completed: 'succeeded',
      }
      return {
        status: map[j.status] ?? 'running',
        model: j.model_output_name ?? null,
        error: j.status === 'error' ? (j.events?.at?.(-1)?.message ?? 'Training failed.') : null,
      }
    },
  }
}
