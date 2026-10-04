import type { SettingsManager } from '@earendil-works/pi-coding-agent'
import { patchPiCompactionTokens, type SettingsManagerLike } from './worker-compaction-patch'

const TOOL_ENTRY = /^[+-]?[A-Za-z_][A-Za-z0-9_]*$/
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** `provider/modelId` → level, dropping unknown levels and blank keys. */
export function normalizeModelThinkingLevels(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const level = String(value ?? '').trim().toLowerCase()
    if (key.includes('/') && THINKING_LEVELS.has(level)) out[key] = level
  }
  return out
}

const BUDGET_LEVELS = ['minimal', 'low', 'medium', 'high']
const isSafeCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** `thinkingBudgets` with only known levels and non-negative integers; undefined when empty. */
export function normalizeThinkingBudgets(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, number> = {}
  for (const level of BUDGET_LEVELS) {
    const v = (raw as Record<string, unknown>)[level]
    if (isSafeCount(v)) out[level] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** `compaction.modelOverrides` keyed by `provider/modelId`; entries without a valid value are dropped. */
export function normalizeCompactionOverrides(raw: unknown): Record<string, { reserveTokens?: number; keepRecentTokens?: number }> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, { reserveTokens?: number; keepRecentTokens?: number }> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.includes('/') || !value || typeof value !== 'object') continue
    const entry: { reserveTokens?: number; keepRecentTokens?: number } = {}
    const { reserveTokens, keepRecentTokens } = value as Record<string, unknown>
    if (isSafeCount(reserveTokens)) entry.reserveTokens = reserveTokens
    if (isSafeCount(keepRecentTokens)) entry.keepRecentTokens = keepRecentTokens
    if (Object.keys(entry).length) out[key.trim()] = entry
  }
  return Object.keys(out).length ? out : undefined
}

type RawSettingsManager = {
  globalSettings?: Record<string, unknown>
  markModified?: (field: string, nestedKey?: string) => void
  save?: () => void
}

function rawInternals(sm: SettingsManager): Required<RawSettingsManager> {
  const internals = sm as unknown as RawSettingsManager
  if (!internals.globalSettings || typeof internals.markModified !== 'function' || typeof internals.save !== 'function') {
    throw new Error('RAW_SETTINGS_UNSUPPORTED')
  }
  return internals as Required<RawSettingsManager>
}

/**
 * Settings newer pi releases read but the bundled runtime has no setter for: patch the global
 * object and mark the (nested) field modified — the save merges only modified fields, exactly
 * like the SDK's own setters — so the key reaches settings.json for any pi that understands it.
 */
function setRawGlobalSetting(sm: SettingsManager, field: string, value: unknown, nestedKey?: string): void {
  const internals = rawInternals(sm)
  const settings = internals.globalSettings
  if (nestedKey) {
    const current = settings[field]
    const group = current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {}
    if (value === undefined || value === null) delete group[nestedKey]
    else group[nestedKey] = value
    settings[field] = group
    internals.markModified.call(sm, field, nestedKey)
  } else {
    if (value === undefined || value === null) delete settings[field]
    else settings[field] = value
    internals.markModified.call(sm, field)
  }
  internals.save.call(sm)
}

function nonNegativeInt(value: unknown, name: string): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}`)
  return n
}

/**
 * pi ≥ 0.84 reads `modelThinkingLevels` (per-model thinking level, global settings only). The
 * bundled runtime predates the typed setter, so write it the way its own setters do: patch the
 * global object, mark the field modified (the save merges only modified fields) and save.
 */
function setModelThinkingLevels(sm: SettingsManager, levels: Record<string, string>): void {
  setRawGlobalSetting(sm, 'modelThinkingLevels', Object.keys(levels).length > 0 ? levels : undefined)
}

export async function applyPiSettingsPatch(
  sm: SettingsManager,
  patch: Record<string, unknown>,
): Promise<void> {
  if (patch.defaultProvider !== undefined && patch.defaultModel !== undefined) {
    sm.setDefaultModelAndProvider(String(patch.defaultProvider), String(patch.defaultModel))
  } else if (patch.defaultProvider !== undefined) sm.setDefaultProvider(String(patch.defaultProvider))
  else if (patch.defaultModel !== undefined) sm.setDefaultModel(String(patch.defaultModel))

  if (patch.defaultThinkingLevel !== undefined) {
    sm.setDefaultThinkingLevel(patch.defaultThinkingLevel as Parameters<typeof sm.setDefaultThinkingLevel>[0])
  }
  if (patch.steeringMode !== undefined) {
    sm.setSteeringMode(patch.steeringMode as Parameters<typeof sm.setSteeringMode>[0])
  }
  if (patch.followUpMode !== undefined) {
    sm.setFollowUpMode(patch.followUpMode as Parameters<typeof sm.setFollowUpMode>[0])
  }
  if (patch.transport !== undefined) {
    sm.setTransport(patch.transport as Parameters<typeof sm.setTransport>[0])
  }
  if (patch.compactionEnabled !== undefined) sm.setCompactionEnabled(Boolean(patch.compactionEnabled))
  patchPiCompactionTokens(sm as unknown as SettingsManagerLike, patch)
  if (patch.shellPath !== undefined) {
    sm.setShellPath(typeof patch.shellPath === 'string' ? patch.shellPath : undefined)
  }
  if (patch.imageAutoResize !== undefined) sm.setImageAutoResize(Boolean(patch.imageAutoResize))
  if (patch.enabledModels !== undefined) {
    sm.setEnabledModels(Array.isArray(patch.enabledModels) ? (patch.enabledModels as string[]) : undefined)
  }
  if (patch.retryEnabled !== undefined) sm.setRetryEnabled(Boolean(patch.retryEnabled))
  if (patch.hideThinkingBlock !== undefined) sm.setHideThinkingBlock(Boolean(patch.hideThinkingBlock))
  if (patch.showImages !== undefined) sm.setShowImages(Boolean(patch.showImages))
  if (patch.blockImages !== undefined) sm.setBlockImages(Boolean(patch.blockImages))
  if (patch.enableSkillCommands !== undefined) sm.setEnableSkillCommands(Boolean(patch.enableSkillCommands))
  if (patch.quietStartup !== undefined) sm.setQuietStartup(Boolean(patch.quietStartup))
  if (patch.defaultProjectTrust !== undefined) {
    sm.setDefaultProjectTrust(patch.defaultProjectTrust as Parameters<typeof sm.setDefaultProjectTrust>[0])
  }
  if (patch.shellCommandPrefix !== undefined) {
    sm.setShellCommandPrefix(
      typeof patch.shellCommandPrefix === 'string' ? patch.shellCommandPrefix : undefined,
    )
  }
  if (patch.npmCommand !== undefined) {
    const command = Array.isArray(patch.npmCommand)
      ? patch.npmCommand.map(String).filter(Boolean)
      : typeof patch.npmCommand === 'string' && patch.npmCommand.trim()
        ? patch.npmCommand.trim().split(/\s+/)
        : undefined
    sm.setNpmCommand(command && command.length ? command : undefined)
  }
  if (patch.treeFilterMode !== undefined) {
    sm.setTreeFilterMode(patch.treeFilterMode as Parameters<typeof sm.setTreeFilterMode>[0])
  }
  if (patch.doubleEscapeAction !== undefined) {
    sm.setDoubleEscapeAction(
      patch.doubleEscapeAction as Parameters<typeof sm.setDoubleEscapeAction>[0],
    )
  }
  if (patch.httpIdleTimeoutMs !== undefined) sm.setHttpIdleTimeoutMs(Number(patch.httpIdleTimeoutMs))
  if (patch.modelThinkingLevels !== undefined) {
    setModelThinkingLevels(sm, normalizeModelThinkingLevels(patch.modelThinkingLevels))
  }
  if (patch.showCacheMissNotices !== undefined) sm.setShowCacheMissNotices(Boolean(patch.showCacheMissNotices))
  if (patch.websocketConnectTimeoutMs !== undefined) {
    setRawGlobalSetting(sm, 'websocketConnectTimeoutMs', nonNegativeInt(patch.websocketConnectTimeoutMs, 'websocketConnectTimeoutMs'))
  }
  if (patch.retryMaxRetries !== undefined) {
    setRawGlobalSetting(sm, 'retry', nonNegativeInt(patch.retryMaxRetries, 'retry.maxRetries'), 'maxRetries')
  }
  if (patch.retryBaseDelayMs !== undefined) {
    setRawGlobalSetting(sm, 'retry', nonNegativeInt(patch.retryBaseDelayMs, 'retry.baseDelayMs'), 'baseDelayMs')
  }
  if (patch.retryMaxAgentDelayMs !== undefined) {
    setRawGlobalSetting(sm, 'retry', nonNegativeInt(patch.retryMaxAgentDelayMs, 'retry.maxAgentDelayMs'), 'maxAgentDelayMs')
  }
  if (patch.cacheWarming !== undefined) {
    const mode = String(patch.cacheWarming)
    if (!['off', 'streaming', 'idle'].includes(mode)) throw new Error('Invalid cacheWarming')
    setRawGlobalSetting(sm, 'cacheWarming', mode)
  }
  if ('thinkingBudgets' in patch) setRawGlobalSetting(sm, 'thinkingBudgets', normalizeThinkingBudgets(patch.thinkingBudgets))
  if ('compactionModelOverrides' in patch) {
    setRawGlobalSetting(sm, 'compaction', normalizeCompactionOverrides(patch.compactionModelOverrides), 'modelOverrides')
  }
  if ('defaultTools' in patch) {
    const tools = patch.defaultTools
    if (tools !== undefined && tools !== null && !(Array.isArray(tools) && tools.every((t) => typeof t === 'string' && TOOL_ENTRY.test(t)))) {
      throw new Error('Invalid defaultTools')
    }
    setRawGlobalSetting(sm, 'defaultTools', tools ?? undefined)
  }
  if (patch.codemodeMode !== undefined) {
    const mode = String(patch.codemodeMode)
    if (!['on', 'only'].includes(mode)) throw new Error('Invalid codemode.mode')
    setRawGlobalSetting(sm, 'codemode', mode, 'mode')
  }
  if (patch.codemodeInlineBudget !== undefined) {
    setRawGlobalSetting(sm, 'codemode', nonNegativeInt(patch.codemodeInlineBudget, 'codemode.inlineBudget'), 'inlineBudget')
  }
  if (patch.isProjectTrusted === true) sm.setProjectTrusted(true)
  if (patch.isProjectTrusted === false) sm.setProjectTrusted(false)
  await sm.flush()
  const errors = sm.drainErrors().filter((entry) => entry.scope === 'global')
  if (errors.length > 0) throw errors[0].error
}
