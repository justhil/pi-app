import type { ModelInfo } from '@shared/ipc-contract'
import { ipcClient } from '@renderer/lib/ipc-client'

let snapshot: ModelInfo[] = []
let inFlight: { generation: number; promise: Promise<ModelInfo[]> } | null = null
let generation = 0
let invalidated = true
const listeners = new Set<(models: ModelInfo[]) => void>()

export function peekAvailableModels(): ModelInfo[] {
  return snapshot
}

export function subscribeAvailableModels(listener: (models: ModelInfo[]) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function refreshAvailableModels(): Promise<ModelInfo[]> {
  const requestGeneration = generation
  if (inFlight?.generation === requestGeneration) return inFlight.promise
  invalidated = false
  const invokeResult = ipcClient.invoke('model.list', { scope: 'available' })
  const promise = (invokeResult && typeof (invokeResult as PromiseLike<unknown>).then === 'function'
    ? Promise.resolve(invokeResult)
    : Promise.resolve({ models: snapshot }))
    .then((res) => {
      if (requestGeneration !== generation) return snapshot
      snapshot = Array.isArray(res?.models) ? res.models : []
      for (const listener of listeners) listener(snapshot)
      return snapshot
    })
    .catch((error) => {
      if (requestGeneration === generation) invalidated = true
      throw error
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null
    })
  inFlight = { generation: requestGeneration, promise }
  return promise
}

export function ensureAvailableModels(): Promise<ModelInfo[]> {
  if (!invalidated && snapshot.length > 0) return Promise.resolve(snapshot)
  return refreshAvailableModels()
}

export function invalidateAvailableModels(): void {
  generation += 1
  invalidated = true
}

export function prefetchAvailableModels(): void {
  void ensureAvailableModels().catch(() => {})
}

export function clearAvailableModelsCacheForTests(): void {
  snapshot = []
  inFlight = null
  generation = 0
  invalidated = true
  listeners.clear()
}
