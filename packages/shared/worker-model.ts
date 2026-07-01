/** Narrow model reference from Pi SDK session (worker boundary). */
export type SessionModelRef = {
  provider?: string
  modelId?: string
  id?: string
}

export function formatSessionModelKey(model: SessionModelRef | null | undefined): string | undefined {
  if (!model) return undefined
  const provider = model.provider
  const modelId = model.modelId ?? model.id
  if (provider && modelId) return `${provider}/${modelId}`
  if (modelId && String(modelId).includes('/')) return String(modelId)
  return modelId ? String(modelId) : undefined
}