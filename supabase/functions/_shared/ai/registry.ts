/**
 * Picks the model and API key for a call.
 *
 * Keys: the workspace's own key for the provider (Settings → Models) wins.
 * Without one, the platform key from the environment is used if the
 * workspace's plan includes platform AI and the workspace hasn't turned it
 * off. Otherwise the call fails with a message telling the admin what to add.
 */
import type { Db } from '../db.ts'
import { env, fakeAi } from '../env.ts'
import { HttpError } from '../http.ts'
import { anthropicModel } from './anthropic.ts'
import { CHAT_MODELS } from './catalog.ts'
import { mockChat, mockEmbeddings } from './mock.ts'
import { compatibleModel, openaiEmbeddings, openaiModel } from './openai.ts'
import type { ChatModel, ChatProvider, EmbeddingModel, EmbeddingProvider } from './types.ts'
import { voyageEmbeddings } from './voyage.ts'

type KeyedProvider = 'anthropic' | 'openai' | 'voyage' | 'together' | 'openai_compatible'

const PLATFORM_ENV: Partial<Record<KeyedProvider, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  voyage: 'VOYAGE_API_KEY',
  together: 'TOGETHER_API_KEY',
}

const PROVIDER_NAMES: Record<KeyedProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  voyage: 'Voyage AI',
  together: 'Together AI',
  openai_compatible: 'the model endpoint',
}

export const TOGETHER_BASE_URL = 'https://api.together.ai/v1'

export interface Credential {
  apiKey: string
  baseUrl?: string
  platform: boolean
}

const cache = new Map<string, { at: number; value: Credential }>()

export async function resolveCredential(
  db: Db,
  workspaceId: string,
  provider: KeyedProvider,
  credentialId?: string | null,
): Promise<Credential> {
  const cacheKey = `${workspaceId}:${provider}:${credentialId ?? ''}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < 60_000) return hit.value

  let q = db
    .from('provider_credentials')
    .select('id, secret_id, base_url, label')
    .eq('workspace_id', workspaceId)
  // A credential id must also be for this provider, so a key is never sent to another provider's API.
  q = credentialId ? q.eq('id', credentialId).eq('provider', provider) : q.eq('provider', provider).order('created_at', { ascending: true })
  const { data: rows } = await q.limit(1)
  const row = rows?.[0]

  let value: Credential | null = null
  if (row) {
    const { data: secret } = await db.rpc('read_secret', { p_id: row.secret_id })
    if (secret) value = { apiKey: secret as string, baseUrl: row.base_url ?? undefined, platform: false }
  }

  if (!value) {
    const envName = PLATFORM_ENV[provider]
    const platformKey = envName ? env(envName) : undefined
    if (platformKey && (await platformAllowed(db, workspaceId))) {
      value = { apiKey: platformKey, platform: true }
    }
  }

  if (!value) {
    throw new HttpError(
      400,
      'missing_model_key',
      `No API key for ${PROVIDER_NAMES[provider]}. An admin can add one in Settings → Models.`,
    )
  }
  cache.set(cacheKey, { at: Date.now(), value })
  return value
}

async function platformAllowed(db: Db, workspaceId: string): Promise<boolean> {
  const { data } = await db.from('workspaces').select('settings, plans(limits)').eq('id', workspaceId).maybeSingle()
  if (!data) return false
  const limits = (data as any).plans?.limits ?? {}
  return limits.platform_ai !== false && (data as any).settings?.allow_platform_ai !== false
}

export interface ModelConfig {
  provider: ChatProvider
  model: string
  custom_model_id?: string | null
  /** Set when resolving a custom model: use this exact credential. */
  credential_id?: string | null
  max_tokens?: number
  temperature?: number | null
}

export async function chatModel(db: Db, workspaceId: string, cfg: ModelConfig): Promise<ChatModel> {
  if (fakeAi() || cfg.provider === 'mock') return mockChat(cfg.model)

  if (cfg.custom_model_id) {
    const { data: cm } = await db
      .from('custom_models')
      .select('provider, model, credential_id')
      .eq('id', cfg.custom_model_id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!cm) throw new HttpError(400, 'bad_model', 'The custom model for this bot no longer exists.')
    return chatModel(db, workspaceId, { provider: cm.provider, model: cm.model, credential_id: cm.credential_id })
  }

  const credentialId = cfg.credential_id ?? undefined
  switch (cfg.provider) {
    case 'anthropic': {
      const c = await resolveCredential(db, workspaceId, 'anthropic', credentialId)
      return anthropicModel({ apiKey: c.apiKey, model: cfg.model, baseUrl: c.baseUrl, platformKey: c.platform })
    }
    case 'openai': {
      const c = await resolveCredential(db, workspaceId, 'openai', credentialId)
      return openaiModel({ apiKey: c.apiKey, model: cfg.model, baseUrl: c.baseUrl, platformKey: c.platform })
    }
    case 'together': {
      const c = await resolveCredential(db, workspaceId, 'together', credentialId)
      return compatibleModel({
        apiKey: c.apiKey, model: cfg.model, baseUrl: c.baseUrl ?? TOGETHER_BASE_URL, provider: 'together', platformKey: c.platform,
      })
    }
    case 'openai_compatible': {
      const c = await resolveCredential(db, workspaceId, 'openai_compatible', credentialId)
      if (!c.baseUrl) throw new HttpError(400, 'bad_model', 'This model endpoint has no base URL. Edit it in Settings → Models.')
      return compatibleModel({
        apiKey: c.apiKey, model: cfg.model, baseUrl: c.baseUrl, provider: 'openai_compatible', platformKey: c.platform,
      })
    }
    default:
      throw new HttpError(400, 'bad_model', `Unknown model provider "${cfg.provider}".`)
  }
}

export async function embeddingModel(
  db: Db,
  workspaceId: string,
  provider: EmbeddingProvider,
  model: string,
): Promise<EmbeddingModel> {
  if (fakeAi() || provider === 'mock') return mockEmbeddings()
  if (provider === 'voyage') {
    const c = await resolveCredential(db, workspaceId, 'voyage')
    return voyageEmbeddings({ apiKey: c.apiKey, model, platformKey: c.platform })
  }
  const c = await resolveCredential(db, workspaceId, 'openai')
  return openaiEmbeddings({ apiKey: c.apiKey, model, platformKey: c.platform })
}

/** Test hook. */
export function clearCredentialCache() {
  cache.clear()
}

/**
 * A model chosen by a user for one run (playground, eval) instead of the
 * bot's own: only built-in catalogue models or this workspace's custom models.
 */
export async function safeModelOverride(db: Db, workspaceId: string, v: unknown): Promise<ModelConfig | null> {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.custom_model_id === 'string') {
    const { data } = await db.from('custom_models').select('id').eq('id', o.custom_model_id).eq('workspace_id', workspaceId).maybeSingle()
    if (!data) throw new HttpError(400, 'bad_model', 'That model is not available in this workspace.')
    return { provider: 'openai_compatible', model: '', custom_model_id: data.id as string }
  }
  const m = CHAT_MODELS.find((x) => x.provider === o.provider && x.id === o.model)
  if (!m) throw new HttpError(400, 'bad_model', 'Choose one of the listed models.')
  return { provider: m.provider, model: m.id }
}
