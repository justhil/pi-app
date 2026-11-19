import { create } from 'zustand'
import type { UpstreamCatalogSnapshot } from '@shared/models-dev-catalog'
import { ipcClient } from '@renderer/lib/ipc-client'

interface UpstreamModelCatalogState {
  snapshot: UpstreamCatalogSnapshot | null
  loading: boolean
  error: string | null
  attempted: boolean
}

export const useUpstreamModelCatalogStore = create<UpstreamModelCatalogState>(() => ({
  snapshot: null,
  loading: false,
  error: null,
  attempted: false,
}))

let inflight: Promise<UpstreamCatalogSnapshot | null> | null = null

async function fetchCatalog(force: boolean): Promise<UpstreamCatalogSnapshot | null> {
  if (inflight && !force) return inflight
  useUpstreamModelCatalogStore.setState({ loading: true, ...(force ? { error: null } : {}) })
  const req = ipcClient
    .invoke('pi.models.catalog', { force })
    .then((res) => {
      const snap = res && typeof res === 'object' && Array.isArray((res as UpstreamCatalogSnapshot).models)
        ? (res as UpstreamCatalogSnapshot)
        : null
      useUpstreamModelCatalogStore.setState((prev) => ({
        snapshot: snap ?? prev.snapshot,
        loading: false,
        attempted: true,
        error: snap?.error ?? null,
      }))
      return snap
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      useUpstreamModelCatalogStore.setState({
        loading: false,
        attempted: true,
        error: msg,
      })
      return null
    })
    .finally(() => {
      if (inflight === req) inflight = null
    })
  inflight = req
  return req
}

export function ensureUpstreamCatalogLoaded(): Promise<UpstreamCatalogSnapshot | null> {
  const st = useUpstreamModelCatalogStore.getState()
  if (st.snapshot && !st.snapshot.stale) return Promise.resolve(st.snapshot)
  if (st.loading && inflight) return inflight
  if (st.attempted && !st.snapshot) return Promise.resolve(null)
  return fetchCatalog(false)
}

export function refreshUpstreamCatalog(): Promise<UpstreamCatalogSnapshot | null> {
  return fetchCatalog(true)
}
