import type { ModelInfo } from '@shared/ipc-contract'
import { ensureAvailableModels, ensureCatalogModels } from '@renderer/lib/available-models-cache'

type ModelRow = Pick<ModelInfo, 'id' | 'provider' | 'name' | 'contextWindow'>

/**
 * Resolve a composer model key (`provider/id`) to its model row. Exact identity only: the old
 * substring fallback resolved `openai/gpt-5.5` to `gpt-5` and showed the wrong context window.
 */
export function findModelForKey<T extends ModelRow>(models: T[], modelKey: string): T | null {
  const key = modelKey.trim()
  if (!key) return null
  const slash = key.indexOf('/')
  if (slash > 0) {
    const provider = key.slice(0, slash)
    const id = key.slice(slash + 1)
    const exact = models.find((model) => model.provider === provider && model.id === id)
    if (exact) return exact
  }
  return models.find((model) => model.id === key || model.name === key) ?? null
}

/** Context window for the composer model: warm available-models cache first, catalog once as fallback. */
export async function lookupContextWindow(modelKey: string): Promise<number | null> {
  const fromAvailable = findModelForKey(await ensureAvailableModels().catch(() => []), modelKey)
  if (fromAvailable && fromAvailable.contextWindow > 0) return fromAvailable.contextWindow
  const fromCatalog = findModelForKey(await ensureCatalogModels(), modelKey)
  return fromCatalog && fromCatalog.contextWindow > 0 ? fromCatalog.contextWindow : null
}
