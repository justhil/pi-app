/** Minimal surface of Pi SDK modelRegistry used by the desktop worker. */
export type PiModelRegistryLike = {
  find?: (provider: string, modelId: string) => unknown
  get?: (provider: string, modelId: string) => unknown
}

export function resolveModelFromRegistry(
  registry: PiModelRegistryLike | null | undefined,
  provider: string,
  modelId: string,
): unknown {
  if (!registry) return undefined
  return registry.find?.(provider, modelId) ?? registry.get?.(provider, modelId)
}