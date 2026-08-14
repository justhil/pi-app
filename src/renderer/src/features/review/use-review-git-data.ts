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

/** 模块级缓存（按工作区 identity）：面板重挂载/切 tab 时立即渲染上次快照，避免 loading 闪烁 */
const dataCache = new Map<string, ReviewGitData>()

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
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const [state, setState] = useState<{
    identity: string
    data: ReviewGitData | null
    loading: boolean
    refreshing: boolean
  }>({ identity: '', data: null, loading: false, refreshing: false })

  const refresh = useCallback(async (): Promise<void> => {
    const requestIdentity = identityRef.current
    if (!requestIdentity) return
    if (inFlightRef.current) {
      queuedRef.current = true
      return inFlightRef.current
    }

    const currentData =
      dataRef.current.identity === requestIdentity
        ? dataRef.current.data
        : (dataCache.get(requestIdentity) ?? null)
    setState({
      identity: requestIdentity,
      data: currentData,
      loading: !currentData,
      refreshing: !!currentData,
    })
    const request = (async () => {
      try {
        const response = await ipcClient.invoke('review.getDiff', { sessionId: '', scope: 'git' })
        if (identityRef.current !== requestIdentity) return
        const next = normalizeGitData((response?.diff || {}) as RawGitDiff)
        const previous = dataRef.current.identity === requestIdentity ? dataRef.current.data : null
        const data = previous?.snapshotKey === next.snapshotKey ? previous : next
        dataRef.current = { identity: requestIdentity, data }
        dataCache.set(requestIdentity, data)
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
        void refreshRef.current()
      }
    })
  }, [])
  refreshRef.current = refresh

  useEffect(() => {
    if (!identity) {
      dataRef.current = { identity: '', data: null }
      setState({ identity: '', data: null, loading: false, refreshing: false })
      return
    }
    void refresh()
  }, [identity, worktreeChangeSignal, refresh])

  useEffect(() => {
    if (!identity) return
    return onGitWorkspaceChanged((payload) => {
      if (payload.cwd.replace(/\\/g, '/') === identityRef.current) void refresh()
    })
  }, [identity, refresh])

  const visible =
    state.identity === identity
      ? state
      : identity && dataCache.has(identity)
        ? { identity, data: dataCache.get(identity)!, loading: false, refreshing: true }
        : null
  return {
    gitData: visible?.data || null,
    loading: visible?.loading || false,
    refreshing: visible?.refreshing || false,
    refresh,
  }
}
