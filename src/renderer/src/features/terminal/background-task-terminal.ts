import type { BackgroundTaskSnapshot } from '@shared/background-tasks'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useBackgroundTasksStore } from '@renderer/stores/background-tasks-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { clearTerminalBuffer, pushTerminalOutput } from './terminal-bridge'
import { terminalActions, useTerminalStore } from './terminal-store'

const POLL_MS = 650

type FollowerHandle = {
  stop: () => void
}

const activeFollowers = new Map<string, FollowerHandle>()

export function backgroundTaskPtyId(taskId: string): string {
  return `bg-task:${taskId}`
}

function normalizeCrLf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n')
}

function compactCommandTitle(command: string, fallbackId: string): string {
  const firstLine = command.replace(/\s+/g, ' ').trim()
  if (!firstLine) return fallbackId
  return firstLine.length > 26 ? `${firstLine.slice(0, 26)}…` : firstLine
}

function findLatestTaskInStore(taskId: string): BackgroundTaskSnapshot | undefined {
  const buckets = useBackgroundTasksStore.getState().tasksBySession
  for (const list of Object.values(buckets)) {
    const hit = list.find((item) => item.id === taskId)
    if (hit) return hit
  }
  return undefined
}

function formatSettledFooter(task: Pick<BackgroundTaskSnapshot, 'status' | 'exitCode' | 'error'>): string {
  if (task.status === 'killed') {
    return `\r\n\x1b[33m[background task stopped]\x1b[0m\r\n`
  }
  if (task.status === 'timed_out') {
    return `\r\n\x1b[33m[background task timed out]\x1b[0m\r\n`
  }
  if (task.status === 'failed') {
    const msg = task.error ? `: ${task.error}` : ''
    return `\r\n\x1b[31m[background task failed${msg}]\x1b[0m\r\n`
  }
  const code = task.exitCode ?? 0
  if (code === 0) {
    return `\r\n\x1b[32m[exited with code 0]\x1b[0m\r\n`
  }
  return `\r\n\x1b[31m[exited with code ${code}]\x1b[0m\r\n`
}

export function stopBackgroundTaskLogFollower(ptyId: string): void {
  const handle = activeFollowers.get(ptyId)
  if (handle) {
    activeFollowers.delete(ptyId)
    handle.stop()
  }
  clearTerminalBuffer(ptyId)
}

function startBackgroundTaskLogFollower(ptyId: string, initialTask: BackgroundTaskSnapshot): void {
  stopBackgroundTaskLogFollower(ptyId)

  let stopped = false
  let timer: number | null = null
  let offset = 0
  let footerWritten = false
  let inFlight = false

  const metaParts = [initialTask.id, initialTask.cwd].filter(Boolean).join(' · ')
  pushTerminalOutput(
    ptyId,
    `\x1b[1;36m$\x1b[0m \x1b[1m${initialTask.command}\x1b[0m\r\n` +
      `\x1b[2m[${metaParts}]\x1b[0m\r\n\r\n`,
  )

  const finishIfSettled = (latest: BackgroundTaskSnapshot) => {
    if (latest.status === 'running') return false
    if (!footerWritten) {
      footerWritten = true
      pushTerminalOutput(ptyId, formatSettledFooter(latest))
    }
    const exitCode = latest.exitCode ?? (latest.status === 'exited' ? 0 : 1)
    terminalActions.updateBackgroundTask(ptyId, {
      status: latest.status,
      exitCode: latest.exitCode,
      outputPath: latest.outputPath,
    })
    terminalActions.markExited(ptyId, exitCode)
    return true
  }

  const pump = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const latest = findLatestTaskInStore(initialTask.id) ?? initialTask
      const outputPath = latest.outputPath || initialTask.outputPath

      if (outputPath) {
        let more = true
        let rounds = 0
        while (!stopped && more && rounds < 6) {
          rounds += 1
          const workspaceId = useUIStore.getState().currentWorkspace || undefined
          const res = (await ipcClient.invoke('backgroundTasks.readLog', {
            outputPath,
            ...(workspaceId ? { workspaceId } : {}),
            offset,
            maxBytes: 64 * 1024,
          })) as
            | {
                ok?: boolean
                text?: string
                nextOffset?: number
                sizeBytes?: number
                skippedPrefix?: boolean
              }
            | undefined
          if (!res || res.ok === false) {
            if (offset === 0 && latest.tail) {
              pushTerminalOutput(ptyId, normalizeCrLf(latest.tail))
              offset = latest.tail.length
            }
            break
          }
          if (res.skippedPrefix) {
            pushTerminalOutput(ptyId, `\x1b[2m… earlier output truncated (showing latest 128 KB) …\x1b[0m\r\n`)
          }
          if (res.text) {
            pushTerminalOutput(ptyId, normalizeCrLf(res.text))
          }
          const next = typeof res.nextOffset === 'number' ? res.nextOffset : offset
          more = next > offset && typeof res.sizeBytes === 'number' && next < res.sizeBytes
          offset = next
        }
      } else if (offset === 0 && latest.tail) {
        pushTerminalOutput(ptyId, normalizeCrLf(latest.tail))
        offset = latest.tail.length
      }

      if (stopped) return

      const afterRead = findLatestTaskInStore(initialTask.id) ?? latest
      if (finishIfSettled(afterRead)) {
        activeFollowers.delete(ptyId)
        return
      }
      timer = window.setTimeout(() => void pump(), POLL_MS)
    } catch {
      if (!stopped) {
        timer = window.setTimeout(() => void pump(), POLL_MS * 2)
      }
    } finally {
      inFlight = false
    }
  }

  const unsubStore = useBackgroundTasksStore.subscribe(() => {
    if (stopped) return
    const latest = findLatestTaskInStore(initialTask.id)
    if (latest && latest.status !== 'running' && !footerWritten) {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      void pump()
    }
  })

  activeFollowers.set(ptyId, {
    stop: () => {
      stopped = true
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      unsubStore()
    },
  })

  void pump()
}

/**
 * Open (or focus existing) built-in TerminalDrawer tab streaming a background_run task's output.
 */
export function openBackgroundTaskInTerminal(task: BackgroundTaskSnapshot): string {
  const ptyId = backgroundTaskPtyId(task.id)
  const existingTab = useTerminalStore
    .getState()
    .tabs.find((tab) => tab.panes.some((pane) => pane.ptyId === ptyId))

  if (existingTab) {
    const paneIndex = existingTab.panes.findIndex((p) => p.ptyId === ptyId)
    terminalActions.focusTab(existingTab.id)
    if (paneIndex >= 0) terminalActions.focusPane(existingTab.id, paneIndex)
    terminalActions.setOpen(true)
    return existingTab.id
  }

  const tabId = terminalActions.addTab({
    ptyId,
    profile: {
      id: `bg:${task.id}`,
      name: compactCommandTitle(task.command, task.id),
      path: task.outputPath || task.id,
      args: [],
      kind: 'background-task',
    },
    ...(task.status !== 'running' ? { exited: task.exitCode ?? (task.status === 'exited' ? 0 : 1) } : {}),
    backgroundTask: {
      taskId: task.id,
      command: task.command,
      outputPath: task.outputPath,
      sessionFile: task.sessionFile,
      cwd: task.cwd,
      status: task.status,
      exitCode: task.exitCode,
    },
  })
  startBackgroundTaskLogFollower(ptyId, task)
  return tabId
}
