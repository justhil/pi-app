import { useEffect, useSyncExternalStore } from 'react'
import type { AdapterCatalog, AdapterJson } from '@extension-compat/adapter-schema'
import { ipcClient } from './ipc-client'

const snapshots = new Map<string, AdapterCatalog>()
const pending = new Map<string, Promise<AdapterCatalog>>()
const listeners = new Set<() => void>()
let activeWorkspace = ''
let epoch = 0
let version = 0

function notify(): void {
  version++
  for (const listener of listeners) listener()
}

export function activateAdapterWorkspace(workspaceId: string | null): void {
  activeWorkspace = workspaceId ?? ''
  notify()
  void loadAdapterCatalog(activeWorkspace).catch(() => {})
}

export function invalidateAdapterSnapshots(): void {
  epoch++
  snapshots.clear()
  pending.clear()
  notify()
  void loadAdapterCatalog(activeWorkspace).catch(() => {})
}

export function loadAdapterCatalog(workspaceId = activeWorkspace, refresh = false, revalidate = false): Promise<AdapterCatalog> {
  if (!refresh && !revalidate && snapshots.has(workspaceId)) return Promise.resolve(snapshots.get(workspaceId)!)
  if (pending.has(workspaceId)) return pending.get(workspaceId)!
  const started = epoch
  const job = ipcClient.invoke('adapters.json.catalog', { workspaceId, refresh }).then((result: AdapterCatalog) => {
    const catalog = { ...result, adapters: result.adapters ?? [], errors: result.errors ?? [], sources: result.sources ?? {} }
    if (started === epoch) {
      const changed = snapshots.get(workspaceId)?.revision !== catalog.revision
      snapshots.set(workspaceId, catalog)
      if (changed) notify()
    }
    return catalog
  }).finally(() => { if (pending.get(workspaceId) === job) pending.delete(workspaceId) })
  pending.set(workspaceId, job)
  return job
}

export function revalidateActiveAdapterCatalog(): Promise<AdapterCatalog> {
  return loadAdapterCatalog(activeWorkspace, false, true)
}

export function currentAdapterCatalog(): readonly AdapterJson[] {
  return snapshots.get(activeWorkspace)?.adapters ?? []
}

export function useAdapterCatalog(workspaceId = activeWorkspace): AdapterCatalog | undefined {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => version)
  useEffect(() => { void loadAdapterCatalog(workspaceId).catch(() => {}) }, [workspaceId])
  return snapshots.get(workspaceId)
}
