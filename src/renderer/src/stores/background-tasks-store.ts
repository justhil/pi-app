import { create } from 'zustand'
import {
  sortBackgroundTasks,
  type BackgroundTaskSnapshot,
} from '@shared/background-tasks'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import { ipcClient } from '@renderer/lib/ipc-client'

export interface ActiveBackgroundAdapterMeta {
  adapterId: string
  icon?: string
  title?: string
}

interface BackgroundTasksStoreState {
  /** Keyed by normalized sessionFile (or 'default' if unavailable). */
  tasksBySession: Record<string, BackgroundTaskSnapshot[]>
  /** Runtime presence of a background-jobs-v1 adapter per session (strict UI gate). */
  activeAdapterBySession: Record<string, ActiveBackgroundAdapterMeta | null>
  loading: boolean
  lastSyncedAt: number
}

export const useBackgroundTasksStore = create<BackgroundTasksStoreState>(() => ({
  tasksBySession: {},
  activeAdapterBySession: {},
  loading: false,
  lastSyncedAt: 0,
}))

function sessionBucketKey(sessionFile: string | null | undefined): string {
  return normalizeSessionFileKey(sessionFile) || sessionFile?.trim() || 'default'
}

export function applyBackgroundTasksEvent(
  sessionFile: string | undefined,
  tasks: BackgroundTaskSnapshot[],
  meta?: { hasActiveAdapter?: boolean; adapterId?: string; icon?: string; title?: string },
): void {
  const key = sessionBucketKey(sessionFile)
  const stamped = sortBackgroundTasks(
    tasks.map((t) => (sessionFile && !t.sessionFile ? { ...t, sessionFile } : t)),
  )
  useBackgroundTasksStore.setState((prev) => {
    const nextAdapters = { ...prev.activeAdapterBySession }
    if (meta?.hasActiveAdapter === true && meta.adapterId) {
      nextAdapters[key] = {
        adapterId: meta.adapterId,
        ...(meta.icon ? { icon: meta.icon } : {}),
        ...(meta.title ? { title: meta.title } : {}),
      }
    } else if (meta?.hasActiveAdapter === false) {
      nextAdapters[key] = null
    }
    return {
      tasksBySession: {
        ...prev.tasksBySession,
        [key]: stamped,
      },
      activeAdapterBySession: nextAdapters,
      lastSyncedAt: Date.now(),
    }
  })
}

export function upsertSingleBackgroundTask(task: BackgroundTaskSnapshot): void {
  const key = sessionBucketKey(task.sessionFile)
  useBackgroundTasksStore.setState((prev) => {
    const existing = prev.tasksBySession[key] ?? []
    const byId = new Map(existing.map((item) => [item.id, item]))
    byId.set(task.id, task)
    return {
      tasksBySession: {
        ...prev.tasksBySession,
        [key]: sortBackgroundTasks(byId.values()),
      },
      lastSyncedAt: Date.now(),
    }
  })
}

export async function refreshBackgroundTasksFromMain(
  activeSessionFile?: string | null,
  workspaceId?: string | null,
): Promise<BackgroundTaskSnapshot[]> {
  useBackgroundTasksStore.setState({ loading: true })
  try {
    const payload: { sessionFile?: string; workspaceId?: string } = {}
    if (activeSessionFile) payload.sessionFile = activeSessionFile
    if (workspaceId) payload.workspaceId = workspaceId
    const res = (await ipcClient.invoke('backgroundTasks.list', payload)) as
      | {
          tasks?: BackgroundTaskSnapshot[]
          activeAdaptersBySession?: Record<string, ActiveBackgroundAdapterMeta | null>
        }
      | undefined
    const tasks = Array.isArray(res?.tasks) ? res.tasks : []
    const grouped: Record<string, BackgroundTaskSnapshot[]> = {}
    for (const task of tasks) {
      const k = sessionBucketKey(task.sessionFile)
      if (!grouped[k]) grouped[k] = []
      grouped[k].push(task)
    }
    for (const k of Object.keys(grouped)) {
      grouped[k] = sortBackgroundTasks(grouped[k])
    }
    if (activeSessionFile) {
      const activeKey = sessionBucketKey(activeSessionFile)
      if (!grouped[activeKey]) grouped[activeKey] = []
    }

    const adapterUpdates: Record<string, ActiveBackgroundAdapterMeta | null> = {}
    if (res?.activeAdaptersBySession && typeof res.activeAdaptersBySession === 'object') {
      for (const [sf, info] of Object.entries(res.activeAdaptersBySession)) {
        adapterUpdates[sessionBucketKey(sf)] = info ?? null
      }
    }

    useBackgroundTasksStore.setState((prev) => ({
      tasksBySession: {
        ...prev.tasksBySession,
        ...grouped,
      },
      activeAdapterBySession: {
        ...prev.activeAdapterBySession,
        ...adapterUpdates,
      },
      loading: false,
      lastSyncedAt: Date.now(),
    }))
    return tasks
  } catch {
    useBackgroundTasksStore.setState({ loading: false })
    return []
  }
}

export function collectVisibleBackgroundTasks(
  tasksBySession: Record<string, BackgroundTaskSnapshot[]>,
  activeAdapterBySession: Record<string, ActiveBackgroundAdapterMeta | null>,
  activeSessionFile: string | null | undefined,
): {
  currentSession: BackgroundTaskSnapshot[]
  otherRunning: BackgroundTaskSnapshot[]
  runningCount: number
  totalCount: number
  activeAdapter: ActiveBackgroundAdapterMeta | null
  shouldShowTrigger: boolean
} {
  const activeKey = activeSessionFile ? sessionBucketKey(activeSessionFile) : null
  const currentSession = activeKey ? (tasksBySession[activeKey] ?? []) : []
  const activeAdapter = activeKey ? (activeAdapterBySession[activeKey] ?? null) : null
  const otherRunning: BackgroundTaskSnapshot[] = []

  for (const [k, list] of Object.entries(tasksBySession)) {
    if (activeKey && k === activeKey) continue
    for (const task of list) {
      if (task.status === 'running') otherRunning.push(task)
    }
  }

  const runningInCurrent = currentSession.filter((t) => t.status === 'running').length
  const totalCount = currentSession.length + otherRunning.length
  return {
    currentSession,
    otherRunning: sortBackgroundTasks(otherRunning),
    runningCount: runningInCurrent + otherRunning.length,
    totalCount,
    activeAdapter,
    // Strict adapter gating: only show bottom trigger if active runtime loaded a background-jobs-v1
    // extension OR there are live/historical tasks to inspect.
    shouldShowTrigger: Boolean(activeAdapter) || totalCount > 0,
  }
}
