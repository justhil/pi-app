import { open, stat } from 'node:fs/promises'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { AppEvent, BackgroundTasksEvent, ExtensionStatusEvent } from '@shared/app-events'
import {
  extractBackgroundTasksFromBranchEntries,
  isSafeBackgroundLogPath,
  mergeBackgroundTask,
  parseBackgroundTaskDetails,
  sortBackgroundTasks,
  type BackgroundJobsProtocolSpec,
  type BackgroundTaskSnapshot,
} from '@shared/background-tasks'
import {
  collectAllowedBackgroundLogRules,
  listBackgroundJobsSpecs,
  resolveBackgroundJobsSpecByExitMessage,
  resolveBackgroundJobsSpecByStatusKey,
  resolveBackgroundJobsSpecByTool,
  resolveStatusPillAdapterByKey,
} from '../extension-compat/status-bar-adapters.js'

const MAX_LOG_TAIL_BYTES = 16 * 1024

type RegisteredToolLike = {
  name?: string
  execute?: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content?: unknown; details?: unknown }>
}

export interface ActiveBackgroundAdapterInfo {
  adapterId: string
  icon?: string
  title?: string
}

export interface DesktopStatusBarHost {
  setStatus: (key: string, text?: string) => void
  captureTool: (toolName: string, payload: unknown) => void
  captureCustomMessage: (msg: unknown) => void
  reconstructFromBranch: (entries: readonly unknown[], sessionFile?: string) => Promise<void>
  resyncCatalog: () => void
  listTasks: () => Promise<{
    tasks: BackgroundTaskSnapshot[]
    activeAdapter: ActiveBackgroundAdapterInfo | null
  }>
  inspectTask: (
    taskId: string,
    outputPathHint?: string,
  ) => Promise<{
    ok: boolean
    task: BackgroundTaskSnapshot | null
    tail: string
    truncated: boolean
    sizeBytes: number
    error?: string
  }>
  killTask: (taskId: string) => Promise<{
    ok: boolean
    task?: BackgroundTaskSnapshot | null
    error?: string
  }>
  dispose: () => void
}

function getRegisteredTool(session: AgentSession | null, name: string): RegisteredToolLike | null {
  if (!session || !name) return null
  const s = session as unknown as {
    _toolRegistry?: Map<string, RegisteredToolLike>
    agent?: { state?: { tools?: RegisteredToolLike[] } }
  }
  const fromRegistry = s._toolRegistry?.get?.(name)
  if (fromRegistry && typeof fromRegistry.execute === 'function') return fromRegistry
  const fromAgent = s.agent?.state?.tools?.find?.((t) => t?.name === name)
  if (fromAgent && typeof fromAgent.execute === 'function') return fromAgent
  return null
}

function detectActiveBackgroundJobsSpec(
  session: AgentSession | null,
  projectDir?: string,
): BackgroundJobsProtocolSpec | null {
  if (!session) return null
  const specs = listBackgroundJobsSpecs(projectDir)
  for (const spec of specs) {
    for (const toolName of spec.tools) {
      if (getRegisteredTool(session, toolName)) return spec
    }
  }
  return null
}

async function readSafeTail(
  filePath: string,
  projectDir?: string,
): Promise<{ tail: string; truncated: boolean; sizeBytes: number } | null> {
  const rules = collectAllowedBackgroundLogRules(projectDir)
  if (!isSafeBackgroundLogPath(filePath, rules)) return null
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return null
    const sizeBytes = info.size
    if (sizeBytes === 0) return { tail: '', truncated: false, sizeBytes: 0 }
    const start = Math.max(0, sizeBytes - MAX_LOG_TAIL_BYTES)
    const length = sizeBytes - start
    const fh = await open(filePath, 'r')
    try {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await fh.read(buf, 0, length, start)
      let tail = buf.subarray(0, bytesRead).toString('utf8')
      if (start > 0) {
        const nl = tail.indexOf('\n')
        if (nl >= 0 && nl < 240) tail = tail.slice(nl + 1)
      }
      return { tail, truncated: start > 0, sizeBytes }
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}

export function createDesktopStatusBarHost(deps: {
  emit: (event: AppEvent) => void
  baseEvent: () => Record<string, unknown>
  getSession: () => AgentSession | null
  projectDir?: string
}): DesktopStatusBarHost {
  const taskMap = new Map<string, BackgroundTaskSnapshot>()
  const publishedPills = new Map<string, string>()
  let activeSessionFile: string | undefined
  let statusRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const currentSessionFile = (): string | undefined => {
    try {
      const sf = deps.getSession()?.sessionManager?.getSessionFile?.()
      if (typeof sf === 'string' && sf.trim()) {
        activeSessionFile = sf
        return sf
      }
    } catch {
      /* ignore */
    }
    return activeSessionFile
  }

  const getActiveAdapterInfo = (): ActiveBackgroundAdapterInfo | null => {
    const spec = detectActiveBackgroundJobsSpec(deps.getSession(), deps.projectDir)
    if (!spec) return null
    return {
      adapterId: spec.adapterId,
      ...(spec.icon ? { icon: spec.icon } : {}),
      ...(spec.title ? { title: spec.title } : {}),
    }
  }

  const emitTasks = () => {
    if (disposed) return
    const active = getActiveAdapterInfo()
    deps.emit({
      ...(deps.baseEvent() as unknown as BackgroundTasksEvent),
      type: 'background_tasks',
      tasks: sortBackgroundTasks(taskMap.values()),
      hasActiveAdapter: Boolean(active),
      ...(active?.adapterId ? { adapterId: active.adapterId } : {}),
      ...(active?.icon ? { icon: active.icon } : {}),
      ...(active?.title ? { title: active.title } : {}),
    })
  }

  const ingest = (raw: unknown, spec: BackgroundJobsProtocolSpec, emitChange = true): boolean => {
    const sf = currentSessionFile()
    const parsed = parseBackgroundTaskDetails(raw, sf, undefined, {
      fields: spec.fields,
      adapterId: spec.adapterId,
    })
    if (parsed.length === 0) return false
    for (const item of parsed) {
      taskMap.set(item.id, mergeBackgroundTask(taskMap.get(item.id), item))
    }
    if (emitChange) emitTasks()
    return true
  }

  const resolveSpecForTask = (task?: BackgroundTaskSnapshot | null): BackgroundJobsProtocolSpec | null => {
    const specs = listBackgroundJobsSpecs(deps.projectDir)
    if (task?.adapterId) {
      const byId = specs.find((s) => s.adapterId === task.adapterId)
      if (byId) return byId
    }
    return detectActiveBackgroundJobsSpec(deps.getSession(), deps.projectDir) ?? specs[0] ?? null
  }

  const refreshRunningTasks = async (): Promise<void> => {
    const session = deps.getSession()
    const running = [...taskMap.values()].filter((t) => t.status === 'running')
    if (!session || running.length === 0) return

    let changed = false
    for (const task of running) {
      const spec = resolveSpecForTask(task)
      const inspectToolName = spec?.inspectTool
      const tool = inspectToolName ? getRegisteredTool(session, inspectToolName) : null
      if (!tool?.execute || !spec) continue
      try {
        const res = await tool.execute(`desktop-status-${task.id}`, { id: task.id })
        if (res?.details) {
          if (ingest(res.details, spec, false)) changed = true
        }
      } catch {
        // Task no longer exists in live extension process — settle as exited.
        taskMap.set(task.id, { ...task, status: 'exited', updatedAt: Date.now() })
        changed = true
      }
    }
    if (changed) emitTasks()
  }

  const emitStatusPill = (
    adapterId: string,
    statusKey: string,
    phase: 'set' | 'clear',
    opts?: {
      text?: string
      icon?: string
      title?: string
      clickAction?: ExtensionStatusEvent['clickAction']
    },
  ) => {
    if (disposed) return
    if (phase === 'set') publishedPills.set(statusKey, adapterId)
    else publishedPills.delete(statusKey)
    deps.emit({
      ...(deps.baseEvent() as unknown as ExtensionStatusEvent),
      type: 'extension_status',
      phase,
      adapterId,
      statusKey,
      ...(opts?.text !== undefined ? { text: opts.text } : {}),
      ...(opts?.icon ? { icon: opts.icon } : {}),
      ...(opts?.title ? { title: opts.title } : {}),
      ...(opts?.clickAction ? { clickAction: opts.clickAction } : {}),
    })
  }

  return {
    captureTool(toolName: string, payload: unknown): void {
      const spec = resolveBackgroundJobsSpecByTool(toolName, deps.projectDir)
      if (!spec) return
      ingest(payload, spec, true)
    },

    captureCustomMessage(msg: unknown): void {
      if (!msg || typeof msg !== 'object') return
      const rec = msg as Record<string, unknown>
      if (typeof rec.customType !== 'string' || !rec.customType) return
      const spec = resolveBackgroundJobsSpecByExitMessage(rec.customType, deps.projectDir)
      if (!spec) return
      ingest(rec.details, spec, true)
    },

    setStatus(key: string, text?: string): void {
      const cleanKey = String(key || '').trim()
      if (!cleanKey) return

      // 1. Background jobs status heartbeat (e.g. "bg:1" -> undefined)
      const bgSpec = resolveBackgroundJobsSpecByStatusKey(cleanKey, deps.projectDir)
      if (bgSpec) {
        if (statusRefreshTimer) clearTimeout(statusRefreshTimer)
        statusRefreshTimer = setTimeout(() => {
          statusRefreshTimer = null
          void refreshRunningTasks()
        }, 120)
      }

      // 2. Declarative status-pill-v1 projection
      const pillAdapter = resolveStatusPillAdapterByKey(cleanKey, deps.projectDir)
      if (pillAdapter?.statusBar) {
        const cleanText = typeof text === 'string' ? text.replace(/\x1b\[[0-9;]*m/g, '').trim() : ''
        if (!cleanText) {
          emitStatusPill(pillAdapter.id, cleanKey, 'clear')
        } else {
          emitStatusPill(pillAdapter.id, cleanKey, 'set', {
            text: cleanText,
            icon: pillAdapter.statusBar.icon,
            title: pillAdapter.statusBar.title ?? pillAdapter.displayName,
            clickAction: pillAdapter.statusBar.clickAction,
          })
        }
      }
    },

    async reconstructFromBranch(entries: readonly unknown[], sessionFile?: string): Promise<void> {
      taskMap.clear()
      activeSessionFile = sessionFile
      const specs = listBackgroundJobsSpecs(deps.projectDir)
      const historical = extractBackgroundTasksFromBranchEntries(entries, sessionFile, specs)
      for (const task of historical) {
        taskMap.set(task.id, task)
      }

      const session = deps.getSession()
      if (session) {
        for (const task of [...taskMap.values()]) {
          if (task.status !== 'running') continue
          const spec = resolveSpecForTask(task)
          const inspectTool = spec?.inspectTool ? getRegisteredTool(session, spec.inspectTool) : null
          if (!inspectTool?.execute || !spec) {
            taskMap.set(task.id, { ...task, status: 'exited' })
            continue
          }
          try {
            const res = await inspectTool.execute(`desktop-reconstruct-${task.id}`, { id: task.id })
            if (res?.details) {
              ingest(res.details, spec, false)
            } else {
              taskMap.set(task.id, { ...task, status: 'exited' })
            }
          } catch {
            taskMap.set(task.id, { ...task, status: 'exited' })
          }
        }
      }

      emitTasks()
    },

    resyncCatalog(): void {
      emitTasks()
    },

    async listTasks() {
      await refreshRunningTasks()
      return {
        tasks: sortBackgroundTasks(taskMap.values()),
        activeAdapter: getActiveAdapterInfo(),
      }
    },

    async inspectTask(taskId: string, outputPathHint?: string) {
      const session = deps.getSession()
      let task = taskMap.get(taskId) ?? null
      const spec = resolveSpecForTask(task)

      if (session && spec?.inspectTool) {
        const tool = getRegisteredTool(session, spec.inspectTool)
        if (tool?.execute) {
          try {
            const res = await tool.execute(`desktop-inspect-${taskId}`, { id: taskId })
            if (res?.details) {
              ingest(res.details, spec, true)
              task = taskMap.get(taskId) ?? task
            }
          } catch {
            /* historical task no longer in live manager — fall through to disk log */
          }
        }
      }

      const targetPath = task?.outputPath || outputPathHint
      const disk = targetPath ? await readSafeTail(targetPath, deps.projectDir) : null
      return {
        ok: true,
        task,
        tail: disk ? disk.tail : (task?.tail ?? ''),
        truncated: disk ? disk.truncated : false,
        sizeBytes: disk ? disk.sizeBytes : (task?.tail?.length ?? 0),
      }
    },

    async killTask(taskId: string) {
      const session = deps.getSession()
      const current = taskMap.get(taskId) ?? null
      const spec = resolveSpecForTask(current)
      const killToolName = spec?.killTool
      const tool = session && killToolName ? getRegisteredTool(session, killToolName) : null
      if (!tool?.execute || !spec) {
        return { ok: false, error: 'Background kill tool is not available in this session' }
      }
      try {
        const res = await tool.execute(`desktop-kill-${taskId}`, { id: taskId })
        if (res?.details) {
          ingest(res.details, spec, true)
        } else {
          if (current) {
            taskMap.set(taskId, { ...current, status: 'killed', updatedAt: Date.now() })
            emitTasks()
          }
        }
        return { ok: true, task: taskMap.get(taskId) ?? null }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    dispose(): void {
      if (disposed) return
      if (statusRefreshTimer) clearTimeout(statusRefreshTimer)
      statusRefreshTimer = null
      for (const [statusKey, adapterId] of [...publishedPills.entries()]) {
        emitStatusPill(adapterId, statusKey, 'clear')
      }
      publishedPills.clear()
      taskMap.clear()
      disposed = true
    },
  }
}
