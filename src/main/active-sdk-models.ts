import { resolveActiveAgentDir } from './agent-dir'
import {
  listAvailableModelsWithSdk as listAvailableModelsCore,
  listCatalogModelsWithSdk as listCatalogModelsCore,
  type ModelEntry,
} from './active-sdk-models-core'

export * from './active-sdk-models-core'

/** Main-process wrappers: default to the active (WSL-aware / env-overridden) agent dir. */
export function listCatalogModelsWithSdk(
  sdk: unknown,
  agentDir = resolveActiveAgentDir(),
): Promise<readonly ModelEntry[]> {
  return listCatalogModelsCore(sdk, agentDir)
}

export function listAvailableModelsWithSdk(
  sdk: unknown,
  agentDir = resolveActiveAgentDir(),
): Promise<readonly ModelEntry[]> {
  return listAvailableModelsCore(sdk, agentDir)
}
