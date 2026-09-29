import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { st } from './worker-runtime.js'

/**
 * Per-model thinking binding (`modelThinkingLevels` in the global pi settings, keyed by exact
 * `provider/modelId`). pi ≥ 0.84 applies it when switching models; the bundled runtime does not,
 * so the Worker applies it itself. Read fresh from disk: the desktop writes it from Settings or
 * the thinking picker while this session's SettingsManager keeps its startup snapshot.
 */
export function boundThinkingLevel(provider: string, modelId: string): string | undefined {
  if (!st.sdk || !provider || !modelId) return undefined
  const path = join(st.sdk.getAgentDir(), 'settings.json')
  if (!existsSync(path)) return undefined
  try {
    const settings = JSON.parse(readFileSync(path, 'utf-8')) as { modelThinkingLevels?: unknown }
    const map = settings.modelThinkingLevels
    if (!map || typeof map !== 'object' || Array.isArray(map)) return undefined
    const level = (map as Record<string, unknown>)[`${provider}/${modelId}`]
    return typeof level === 'string' && level.trim() ? level.trim() : undefined
  } catch {
    return undefined
  }
}
