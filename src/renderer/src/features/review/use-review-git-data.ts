import { useCallback, useEffect, useRef, useState } from 'react'
import { ipcClient, onGitWorkspaceChanged } from '@renderer/lib/ipc-client'
import { parseGitStatus } from './review-git-utils'

export type ReviewGitData = {
  files: { path: string; changeType: string; staged: boolean; unstaged: boolean }[]
  raw: string
  stagedRaw: string
  status: string
  branch?: string
  log?: string
  error?: string
  isRepo?: boolean
  message?: string
  snapshotKey: string
}

type RawGitDiff = {
  raw?: string
  stagedRaw?: string
  status?: string
  branch?: string
  log?: string
  error?: string
  isRepo?: boolean
  message?: string
}

function normalizeGitData(diff: RawGitDiff): ReviewGitData {
  const isRepo = diff.isRepo !== false
  const raw = diff.raw || ''
  const stagedRaw = diff.stagedRaw || ''
  const status = diff.status || ''
  const branch = diff.branch
  const log = diff.log
  const message = diff.message
  const error = isRepo ? diff.error : undefined
  return {
    files: parseGitStatus(status),
    raw,
    stagedRaw,
    status,
    branch,
    log,
    isRepo,
    message,
    error,
    snapshotKey: JSON.stringify([raw, stagedRaw, status, branch, log, isRepo, message, error]),
  }
}

/**
 * The app shell, the review panel and the file tree all watch the same working tree. Share one
 * request per workspace: concurrent callers join the in-flight one, and a signal-driven refresh
 * (e.g. the file-change list resetting on a session switch) reuses a result younger than
 * FRESH_MS. Explicit refreshes (button, git watcher) always fetch, but still join an in-flight one.
 */
const FRESH_MS = 2000
const sharedDiff = new Map<string, { at: number; settled: boolean; promise: Promise<RawGitDiff> }>()

function fetchSharedGitDiff(identity: string, force: boolean): Promise<RawGitDiff> {
  const hit = sharedDiff.get(identity)
  if (hit && (!hit.settled || (!force && Date.now() - hit.at < FRESH_MS))) return hit.promise
  const entry = { at: Date.now(), settled: false, promise: Promise.resolve({} as RawGitDiff) }
  entry.promise = ipcClient
    .invoke('review.getDiff', { sessionId: '', scope: 'git' })
    .then((response) => (response?.diff || {}) as RawGitDiff)
    .finally(() => {
      entry.settled = true
      entry.at = Date.now()
    })
  entry.promise.catch(() => {
    if (sharedDiff.get(identity) === entry) sharedDiff.delete(identity)
  })
  sharedDiff.set(identity, entry)
  return entry.promise
}

export function clearSharedGitDiffForTests(): void {
  sharedDiff.clear()
}

export function useReviewGitData(options: {
  enabled: boolean
  workspace: string | null
  worktreeChangeSignal: unknown
}) {
  const { enabled, workspace, worktreeChangeSignal } = options
  const identity = enabled && workspace ? workspace.replace(/\\/g, '/') : ''
  const identityRef = useRef(identity)
  identityRef.current = identity
  const dataRef = useRef<{ identity: string; data: ReviewGitData | null }>({
    identity: '',
    data: null,
  })
  const inFlightRef = useRef<Promise<void> | null>(null)
  const queuedRef = useRef(false)
  const refreshRef = useRef<(force: boolean) => Promise<void>>(async () => {})
  const [state, setState] = useState<{
    identity: string
    data: ReviewGitData | null
    loading: boolean
    refreshing: boolean
  }>({ identity: '', data: null, loading: false, refreshing: false })

  const load = useCallback(async (force: boolean): Promise<void> => {
    const requestIdentity = identityRef.current
    if (!requestIdentity) return
    if (inFlightRef.current) {
      queuedRef.current = true
      return inFlightRef.current
    }

    const currentData = dataRef.current.identity === requestIdentity ? dataRef.current.data : null
    setState({
      identity: requestIdentity,
      data: currentData,
      loading: !currentData,
      refreshing: !!currentData,
    })
    const request = (async () => {
      try {
        const diff = await fetchSharedGitDiff(requestIdentity, force)
        if (identityRef.current !== requestIdentity) return
        const next = normalizeGitData(diff)
        const previous = dataRef.current.identity === requestIdentity ? dataRef.current.data : null
        const data = previous?.snapshotKey === next.snapshotKey ? previous : next
        dataRef.current = { identity: requestIdentity, data }
        setState({ identity: requestIdentity, data, loading: false, refreshing: false })
      } catch {
        if (identityRef.current !== requestIdentity) return
        setState({ identity: requestIdentity, data: currentData, loading: false, refreshing: false })
      }
    })()
    inFlightRef.current = request
    await request.finally(() => {
      if (inFlightRef.current === request) inFlightRef.current = null
      if (queuedRef.current) {
        queuedRef.current = false
        void refreshRef.current(true)
      }
    })
  }, [])
  refreshRef.current = load
  const refresh = useCallback(() => load(true), [load])

  useEffect(() => {
    if (!identity) {
      dataRef.current = { identity: '', data: null }
      setState({ identity: '', data: null, loading: false, refreshing: false })
      return
    }
    void load(false)
  }, [identity, worktreeChangeSignal, load])

  useEffect(() => {
    if (!identity) return
    return onGitWorkspaceChanged((payload) => {
      if (payload.cwd.replace(/\\/g, '/') === identityRef.current) void refresh()
    })
  }, [identity, refresh])

  const visible = state.identity === identity ? state : null
  return {
    gitData: visible?.data || null,
    loading: visible?.loading || false,
    refreshing: visible?.refreshing || false,
    refresh,
  }
}
