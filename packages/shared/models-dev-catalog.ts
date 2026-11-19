/**
 * Shared upstream model metadata catalog & autocomplete engine backed by models.dev (https://models.dev/api.json).
 * Pure module (zero Electron/DOM dependencies) so Main, Renderer, and tests share identical normalization & matching.
 */

export type UpstreamModelCost = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface UpstreamCatalogModel {
  id: string
  normalizedId: string
  canonicalId?: string
  name: string
  providerId: string
  providerName: string
  providerApi?: string
  releaseDate?: string
  reasoning: boolean
  thinkingLevels?: string[]
  input: ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
  cost?: UpstreamModelCost
}

export interface UpstreamCatalogProvider {
  id: string
  name: string
  api?: string
}

export interface UpstreamCatalogSnapshot {
  source: 'models.dev'
  updatedAt: number
  etag?: string
  stale: boolean
  providerCount: number
  modelCount: number
  models: UpstreamCatalogModel[]
  providers: UpstreamCatalogProvider[]
  error?: string
}

export type ModelSpecDraft = {
  id: string
  name?: string
  reasoning?: boolean
  input?: ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
  cost?: UpstreamModelCost
  thinkingLevelMap?: Record<string, string | null>
}

export interface ModelSuggestionItem {
  id: string
  name: string
  source: 'remote' | 'models.dev' | 'sdk'
  providerLabel?: string
  spec?: UpstreamCatalogModel
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  hasImage?: boolean
  cost?: UpstreamModelCost
  alreadyAdded?: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Normalize model IDs across vendors/relays/aggregators:
 * - Strip namespace prefix before last `/` (e.g. `anthropic/claude-sonnet-4` -> `claude-sonnet-4`)
 * - Strip `:variant` tag suffix (e.g. `:free`, `:thinking`)
 * - Strip `[1m]` / `[200k]` bracketed context markers
 * - Replace `@` with `-` and lowercase
 */
export function normalizeCatalogModelId(modelId: string): string {
  const raw = String(modelId ?? '').trim()
  if (!raw) return ''
  const afterSlash = raw.slice(raw.lastIndexOf('/') + 1)
  const beforeColon = afterSlash.split(':')[0] ?? ''
  let normalized = beforeColon.trim().replace(/@/g, '-').toLowerCase()
  normalized = normalized.replace(/\[\d+[km]\]$/i, '').trim()
  return normalized
}

/** Strip trailing date version stamps like `-20250514` or `-2025-05-14` or `-latest` for fallback matching. */
function stripVersionTail(normalizedId: string): string {
  return normalizedId
    .replace(/-(?:20\d{2}-?\d{2}-?\d{2}|latest|preview)$/i, '')
    .trim()
}

function extractHost(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function toPositiveInt(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined
  return Math.round(v)
}

function toNonNegNum(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined
  return Number(v.toFixed(6))
}

const VALID_PI_THINKING = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

function parseThinkingLevels(rawOptions: unknown): string[] | undefined {
  if (!Array.isArray(rawOptions)) return undefined
  const out: string[] = []
  for (const opt of rawOptions) {
    if (!isRecord(opt)) continue
    if (Array.isArray(opt.values)) {
      for (const val of opt.values) {
        const s = String(val ?? '').trim().toLowerCase()
        if (VALID_PI_THINKING.has(s) && !out.includes(s)) out.push(s)
      }
    }
  }
  return out.length > 0 ? out : undefined
}

function metadataRichness(m: UpstreamCatalogModel): number {
  let score = 0
  if (m.contextWindow) score += 3
  if (m.maxTokens) score += 2
  if (m.cost) score += 3
  if (m.reasoning) score += 1
  if (m.thinkingLevels?.length) score += 1
  if (m.input.includes('image')) score += 1
  if (m.releaseDate) score += 1
  // Prefer direct first-party entries (whose id matches canonical vendor or lacks canonical redirect)
  if (!m.canonicalId || m.canonicalId.startsWith(`${m.providerId}/`)) score += 4
  return score
}

/**
 * Parse and compact the raw `https://models.dev/api.json` payload into a small, deduplicated
 * chat/agent model index (~200-350KB serialized instead of 4-6MB raw).
 */
export function compactModelsDevResponse(
  raw: unknown,
  meta?: { updatedAt?: number; etag?: string },
): UpstreamCatalogSnapshot {
  const updatedAt = meta?.updatedAt ?? Date.now()
  if (!isRecord(raw)) {
    return {
      source: 'models.dev',
      updatedAt,
      ...(meta?.etag ? { etag: meta.etag } : {}),
      stale: false,
      providerCount: 0,
      modelCount: 0,
      models: [],
      providers: [],
    }
  }

  const providers: UpstreamCatalogProvider[] = []
  // Deduplicate by (normalizedId) keeping the richest first-party entry, while also retaining
  // distinct provider-specific entries if they belong to major official providers.
  const bestByNormalized = new Map<string, UpstreamCatalogModel>()
  const byProviderAndNorm = new Map<string, UpstreamCatalogModel>()

  const MAJOR_PROVIDERS = new Set([
    'openai',
    'anthropic',
    'google',
    'deepseek',
    'moonshotai',
    'moonshotai-cn',
    'zhipuai',
    'zhipuai-coding-plan',
    'minimax',
    'minimax-cn',
    'alibaba',
    'alibaba-cn',
    'qwen',
    'xai',
    'mistral',
    'groq',
    'openrouter',
    'siliconflow',
    'siliconflow-cn',
    'volcengine',
    'stepfun',
  ])

  for (const [provKey, provVal] of Object.entries(raw)) {
    if (!isRecord(provVal)) continue
    const providerId = typeof provVal.id === 'string' && provVal.id.trim() ? provVal.id.trim() : provKey
    const providerName =
      typeof provVal.name === 'string' && provVal.name.trim() ? provVal.name.trim() : providerId
    const providerApi =
      typeof provVal.api === 'string' && provVal.api.trim() ? provVal.api.trim() : undefined

    providers.push({ id: providerId, name: providerName, ...(providerApi ? { api: providerApi } : {}) })

    const rawModels = provVal.models
    if (!isRecord(rawModels)) continue

    for (const [modelKey, modelVal] of Object.entries(rawModels)) {
      if (!isRecord(modelVal)) continue
      // Skip non-chat utility models (embeddings / transcription / TTS / pure image generation / moderation)
      const rawType = typeof modelVal.type === 'string' ? modelVal.type.toLowerCase() : ''
      if (rawType && rawType !== 'chat' && rawType !== 'language') continue
      const modalities = isRecord(modelVal.modalities) ? modelVal.modalities : undefined
      const outMods = Array.isArray(modalities?.output)
        ? modalities.output.map((x) => String(x).toLowerCase())
        : []
      if (outMods.length > 0 && !outMods.includes('text')) continue

      const id = typeof modelVal.id === 'string' && modelVal.id.trim() ? modelVal.id.trim() : modelKey
      const normalizedId = normalizeCatalogModelId(id)
      if (!normalizedId) continue

      const name = typeof modelVal.name === 'string' && modelVal.name.trim() ? modelVal.name.trim() : id
      const limit = isRecord(modelVal.limit) ? modelVal.limit : undefined
      const contextWindow = toPositiveInt(limit?.context)
      const maxTokens = toPositiveInt(limit?.output)

      const inMods = Array.isArray(modalities?.input)
        ? modalities.input.map((x) => String(x).toLowerCase())
        : []
      const hasImage = inMods.includes('image')
      const input: ('text' | 'image')[] = hasImage ? ['text', 'image'] : ['text']

      const reasoning = modelVal.reasoning === true
      const thinkingLevels = parseThinkingLevels(modelVal.reasoning_options)

      const rawCost = isRecord(modelVal.cost) ? modelVal.cost : undefined
      const cIn = toNonNegNum(rawCost?.input)
      const cOut = toNonNegNum(rawCost?.output)
      const cRead = toNonNegNum(rawCost?.cache_read)
      const cWrite = toNonNegNum(rawCost?.cache_write)
      const hasAnyCost =
        cIn !== undefined || cOut !== undefined || cRead !== undefined || cWrite !== undefined
      const cost: UpstreamModelCost | undefined = hasAnyCost
        ? {
            input: cIn ?? 0,
            output: cOut ?? 0,
            cacheRead: cRead ?? 0,
            cacheWrite: cWrite ?? 0,
          }
        : undefined

      const canonicalId =
        typeof modelVal.canonical_model_id === 'string' && modelVal.canonical_model_id.trim()
          ? modelVal.canonical_model_id.trim()
          : undefined
      const releaseDate =
        typeof modelVal.release_date === 'string' && modelVal.release_date.trim()
          ? modelVal.release_date.trim()
          : undefined

      const entry: UpstreamCatalogModel = {
        id,
        normalizedId,
        ...(canonicalId ? { canonicalId } : {}),
        name,
        providerId,
        providerName,
        ...(providerApi ? { providerApi } : {}),
        ...(releaseDate ? { releaseDate } : {}),
        reasoning,
        ...(thinkingLevels ? { thinkingLevels } : {}),
        input,
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(cost ? { cost } : {}),
      }

      const prevBest = bestByNormalized.get(normalizedId)
      const score = metadataRichness(entry) + (MAJOR_PROVIDERS.has(providerId) ? 3 : 0)
      const prevScore = prevBest
        ? metadataRichness(prevBest) + (MAJOR_PROVIDERS.has(prevBest.providerId) ? 3 : 0)
        : -1
      if (score > prevScore) {
        bestByNormalized.set(normalizedId, entry)
      }

      if (MAJOR_PROVIDERS.has(providerId)) {
        const pk = `${providerId}\0${normalizedId}`
        const prevProv = byProviderAndNorm.get(pk)
        if (!prevProv || metadataRichness(entry) > metadataRichness(prevProv)) {
          byProviderAndNorm.set(pk, entry)
        }
      }
    }
  }

  // Merge: keep every unique normalized model's best canonical entry, plus provider-specific entries
  // whose specs differ from the global best (so e.g. OpenRouter vs official DeepSeek stay accurate).
  const finalModels: UpstreamCatalogModel[] = []
  const emittedKeys = new Set<string>()

  for (const m of bestByNormalized.values()) {
    const k = `${m.providerId}\0${m.normalizedId}`
    emittedKeys.add(k)
    finalModels.push(m)
  }
  for (const [k, m] of byProviderAndNorm.entries()) {
    if (emittedKeys.has(k)) continue
    const globalBest = bestByNormalized.get(m.normalizedId)
    if (
      !globalBest ||
      globalBest.contextWindow !== m.contextWindow ||
      globalBest.maxTokens !== m.maxTokens ||
      globalBest.cost?.input !== m.cost?.input ||
      globalBest.cost?.output !== m.cost?.output
    ) {
      emittedKeys.add(k)
      finalModels.push(m)
    }
  }

  finalModels.sort((a, b) => {
    const dateCmp = (b.releaseDate || '').localeCompare(a.releaseDate || '')
    if (dateCmp !== 0) return dateCmp
    return a.id.localeCompare(b.id)
  })

  return {
    source: 'models.dev',
    updatedAt,
    ...(meta?.etag ? { etag: meta.etag } : {}),
    stale: false,
    providerCount: providers.length,
    modelCount: finalModels.length,
    models: finalModels,
    providers,
  }
}

function providerMatchesHint(
  model: UpstreamCatalogModel,
  hint?: { providerId?: string; baseUrl?: string },
): boolean {
  if (!hint) return false
  const hintHost = extractHost(hint.baseUrl)
  if (hintHost && model.providerApi && extractHost(model.providerApi) === hintHost) return true
  const pid = (hint.providerId || '').trim().toLowerCase()
  if (!pid) return false
  const mpid = model.providerId.toLowerCase()
  if (mpid === pid) return true
  if (pid === 'moonshot' && mpid.startsWith('moonshotai')) return true
  if (pid === 'zhipu' && mpid.startsWith('zhipuai')) return true
  if (pid === 'gemini' && mpid === 'google') return true
  if (pid === 'qwen' && mpid.startsWith('alibaba')) return true
  if (pid === 'minimax' && mpid.startsWith('minimax')) return true
  return false
}

/**
 * Resolve best-matching upstream metadata spec for a given model ID.
 * Priority: same provider exact -> global exact -> canonical_model_id normalized -> version-tail stripped.
 */
export function resolveUpstreamModelSpec(
  catalog: UpstreamCatalogSnapshot | null | undefined,
  modelId: string,
  hint?: { providerId?: string; baseUrl?: string },
): UpstreamCatalogModel | null {
  if (!catalog?.models?.length) return null
  const rawLower = modelId.trim().toLowerCase()
  const norm = normalizeCatalogModelId(modelId)
  if (!norm) return null
  const stripped = stripVersionTail(norm)

  let best: UpstreamCatalogModel | null = null
  let bestRank = -1

  for (const m of catalog.models) {
    const sameProv = providerMatchesHint(m, hint)
    const canonicalNorm = m.canonicalId ? normalizeCatalogModelId(m.canonicalId) : ''
    let rank = -1

    if (m.id.toLowerCase() === rawLower) {
      rank = sameProv ? 100 : 85
    } else if (m.normalizedId === norm) {
      rank = sameProv ? 95 : 80
    } else if (canonicalNorm && canonicalNorm === norm) {
      rank = sameProv ? 90 : 75
    } else if (stripped && stripped.length >= 4) {
      const mStripped = stripVersionTail(m.normalizedId)
      if (mStripped === stripped) {
        rank = sameProv ? 70 : 58
      }
    }

    if (rank > 0) {
      const total = rank * 10 + Math.min(9, metadataRichness(m))
      if (total > bestRank) {
        bestRank = total
        best = m
      }
    }
  }

  return best
}

/**
 * Build a complete Pi models.json entry using upstream metadata when available,
 * falling back to conservative heuristics when offline or unknown.
 */
export function buildModelEntryFromUpstream(
  modelId: string,
  spec: UpstreamCatalogModel | null | undefined,
): ModelSpecDraft {
  const id = modelId.trim()
  if (spec) {
    const thinkingLevelMap =
      spec.reasoning && spec.thinkingLevels?.length
        ? Object.fromEntries(spec.thinkingLevels.map((lvl) => [lvl, lvl]))
        : spec.reasoning
          ? { xhigh: 'xhigh', max: 'max' }
          : undefined
    return {
      id,
      name: spec.name || id,
      reasoning: spec.reasoning || undefined,
      input: spec.input.includes('image') ? ['text', 'image'] : ['text'],
      ...(spec.contextWindow !== undefined ? { contextWindow: spec.contextWindow } : {}),
      ...(spec.maxTokens !== undefined ? { maxTokens: spec.maxTokens } : {}),
      ...(spec.cost ? { cost: { ...spec.cost } } : {}),
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    }
  }

  const guessReasoning = /^(o\d|gpt-5|claude-opus|claude-sonnet-4|deepseek-reasoner|deepseek-r1|qwq|think|glm-5|kimi-k2)/i.test(
    normalizeCatalogModelId(id),
  )
  const guessVision = /(vision|gpt-4o|gpt-4\.1|gpt-5|gemini|claude-3|claude-4|claude-sonnet-4|claude-opus-4|vl|image)/i.test(id)
  return {
    id,
    name: id,
    reasoning: guessReasoning || undefined,
    input: guessVision ? ['text', 'image'] : ['text'],
    ...(guessReasoning ? { thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } } : {}),
  }
}

/**
 * Compute a non-destructive patch that fills missing or default fields on an existing model entry
 * from an upstream spec while keeping user's advanced compat/sampling/headers untouched.
 */
export function computeSpecFillPatch<
  T extends {
    id: string
    name?: string
    reasoning?: boolean
    input?: unknown
    contextWindow?: number
    maxTokens?: number
    cost?: unknown
    thinkingLevelMap?: Record<string, string | null>
  },
>(existing: T, spec: UpstreamCatalogModel, opts?: { overwriteExisting?: boolean }): Partial<ModelSpecDraft> {
  const overwrite = opts?.overwriteExisting === true
  const patch: Partial<ModelSpecDraft> = {}

  if (spec.name && (overwrite || !existing.name || existing.name === existing.id)) {
    patch.name = spec.name
  }
  if (spec.contextWindow !== undefined && (overwrite || existing.contextWindow == null)) {
    patch.contextWindow = spec.contextWindow
  }
  if (spec.maxTokens !== undefined && (overwrite || existing.maxTokens == null)) {
    patch.maxTokens = spec.maxTokens
  }
  if (overwrite || existing.reasoning === undefined) {
    patch.reasoning = spec.reasoning || undefined
  }
  const hasImageNow = Array.isArray(existing.input) && existing.input.includes('image')
  if (overwrite || (!hasImageNow && spec.input.includes('image')) || !Array.isArray(existing.input)) {
    patch.input = spec.input.includes('image') ? ['text', 'image'] : ['text']
  }
  if (spec.cost && (overwrite || !existing.cost)) {
    patch.cost = { ...spec.cost }
  }
  if (spec.reasoning && (overwrite || !existing.thinkingLevelMap)) {
    patch.thinkingLevelMap = spec.thinkingLevels?.length
      ? Object.fromEntries(spec.thinkingLevels.map((lvl) => [lvl, lvl]))
      : { xhigh: 'xhigh', max: 'max' }
  }

  return patch
}

export interface SearchSuggestionsOptions {
  catalog?: UpstreamCatalogSnapshot | null
  remoteIds?: string[]
  sdkModels?: Array<{
    id: string
    name?: string
    provider?: string
    contextWindow?: number
    maxOutput?: number
    reasoning?: boolean
  }>
  existingIds?: Set<string>
  providerId?: string
  baseUrl?: string
  limit?: number
}

/**
 * Fast ranked autocomplete across fetched `/v1/models`, online `models.dev`, and active Pi SDK catalog.
 */
export function searchModelSuggestions(
  query: string,
  opts: SearchSuggestionsOptions,
): ModelSuggestionItem[] {
  const q = query.trim().toLowerCase()
  const qNorm = normalizeCatalogModelId(q)
  const limit = opts.limit ?? 30
  const existing = opts.existingIds ?? new Set<string>()
  const hint = { providerId: opts.providerId, baseUrl: opts.baseUrl }

  const seen = new Map<string, { item: ModelSuggestionItem; score: number }>()

  const scoreText = (id: string, name: string, sameProv: boolean, baseBonus: number): number => {
    const idLow = id.toLowerCase()
    const idNorm = normalizeCatalogModelId(id)
    const nameLow = name.toLowerCase()
    if (!q) {
      return baseBonus + (sameProv ? 40 : 0)
    }
    let s = -1
    if (idLow === q || idNorm === qNorm) s = 120
    else if (idLow.startsWith(q) || idNorm.startsWith(qNorm)) s = 95
    else if (idLow.includes(q) || idNorm.includes(qNorm)) s = 72
    else if (nameLow.includes(q)) s = 60
    else {
      // Multi-token AND match (e.g. "claude 4.5" or "glm flash")
      const tokens = q.split(/\s+/).filter(Boolean)
      if (tokens.length > 1 && tokens.every((tk) => idLow.includes(tk) || nameLow.includes(tk))) {
        s = 64
      }
    }
    if (s < 0) return -1
    return s + baseBonus + (sameProv ? 22 : 0)
  }

  const upsert = (key: string, item: ModelSuggestionItem, score: number) => {
    const prev = seen.get(key)
    if (!prev || score > prev.score) {
      seen.set(key, { item, score })
    }
  }

  // 1. Remote `/v1/models` IDs (highest priority when user fetched this provider's endpoint)
  for (const rawId of opts.remoteIds ?? []) {
    const spec = resolveUpstreamModelSpec(opts.catalog, rawId, hint) ?? undefined
    const name = spec?.name || rawId
    const s = scoreText(rawId, name, true, 30)
    if (s < 0) continue
    upsert(`id:${rawId.toLowerCase()}`, {
      id: rawId,
      name,
      source: 'remote',
      providerLabel: spec?.providerName,
      spec,
      contextWindow: spec?.contextWindow,
      maxTokens: spec?.maxTokens,
      reasoning: spec?.reasoning,
      hasImage: spec?.input.includes('image'),
      cost: spec?.cost,
      alreadyAdded: existing.has(rawId),
    }, s)
  }

  // 2. Online `models.dev` catalog
  for (const m of opts.catalog?.models ?? []) {
    const sameProv = providerMatchesHint(m, hint)
    const recencyBonus = m.releaseDate && m.releaseDate >= '2025-06' ? 8 : 0
    const s = scoreText(m.id, m.name, sameProv, 12 + recencyBonus)
    if (s < 0) continue
    // Deduplicate by normalized ID when not matched to remote ID
    const dedupKey = seen.has(`id:${m.id.toLowerCase()}`) ? `id:${m.id.toLowerCase()}` : `norm:${m.normalizedId}`
    upsert(dedupKey, {
      id: m.id,
      name: m.name,
      source: 'models.dev',
      providerLabel: m.providerName,
      spec: m,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      hasImage: m.input.includes('image'),
      cost: m.cost,
      alreadyAdded: existing.has(m.id),
    }, s)
  }

  // 3. Active Pi SDK models (offline fallback)
  for (const sm of opts.sdkModels ?? []) {
    const sameProv = Boolean(opts.providerId && sm.provider?.toLowerCase() === opts.providerId.toLowerCase())
    const s = scoreText(sm.id, sm.name || sm.id, sameProv, 6)
    if (s < 0) continue
    const norm = normalizeCatalogModelId(sm.id)
    if (seen.has(`id:${sm.id.toLowerCase()}`) || seen.has(`norm:${norm}`)) continue
    upsert(`norm:${norm}`, {
      id: sm.id,
      name: sm.name || sm.id,
      source: 'sdk',
      providerLabel: sm.provider,
      contextWindow: sm.contextWindow || undefined,
      maxTokens: sm.maxOutput || undefined,
      reasoning: sm.reasoning,
      alreadyAdded: existing.has(sm.id),
    }, s)
  }

  return [...seen.values()]
    .sort((a, b) => {
      // Unadded items slightly ahead of already-added duplicates on equal score
      const addedCmp = Number(Boolean(a.item.alreadyAdded)) - Number(Boolean(b.item.alreadyAdded))
      if (b.score !== a.score) return b.score - a.score
      if (addedCmp !== 0) return addedCmp
      return a.item.id.localeCompare(b.item.id)
    })
    .slice(0, limit)
    .map((entry) => entry.item)
}
