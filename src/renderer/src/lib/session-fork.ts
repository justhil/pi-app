import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { inheritPurgedSessionInStore } from '@renderer/lib/agent-purge-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionItem } from '@renderer/stores/ui-store-types'
import { openSessionIntoWorker } from '@renderer/lib/open-session'
import { composerTurnActive } from '@renderer/lib/session-worker-sync'
import { workspacePathsEqual } from '@shared/workspace-path'
import { isCurrentSubagentSessionPreview } from '@renderer/lib/subagent-session-preview'
import { selectSessionAttention } from '@renderer/lib/session-attention'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'

/** A session picked outside the timeline (sidebar menu); defaults to the open session. */
export type ForkSource = { sessionFile: string; workspacePath: string }

function resolveSourceSessionFile(): string | null {
  const store = useUIStore.getState()
  const fromHistory = store.historySessionFile
  if (fromHistory) return fromHistory
  const fromSessions = store.sessions.find((s) => s.sessionId === store.currentSessionId)?.sessionFile
  return fromSessions || null
}

function isCurrentSource(source: ForkSource | undefined): boolean {
  return !source || sessionFilesEqual(source.sessionFile, resolveSourceSessionFile())
}

function assertIdleForBranchAction(source?: ForkSource): boolean {
  if (!isCurrentSource(source)) {
    // Another session: the sidebar's attention state is the only run signal we have for it.
    if (selectSessionAttention(source!.sessionFile, useUIStore.getState().sessionAttention) !== 'working') return true
    toast.warning(i18n.t('composer:toast.sessionBusyBranch', {
      defaultValue: 'Agent 运行中，请先停止后再 Fork / Clone / 跳转',
    }))
    return false
  }
  if (isCurrentSubagentSessionPreview()) {
    toast.warning(i18n.t('composer:toast.subagentPreviewReadOnly'))
    return false
  }
  const store = useUIStore.getState()
  const busy = composerTurnActive({
    historySessionFile: store.historySessionFile,
    workerLiveSnapshot: store.workerLiveSnapshot,
    sessionRuntimeRunning: store.sessionRuntimeRunning,
  })
  if (busy) {
    toast.warning(i18n.t('composer:toast.sessionBusyBranch', {
      defaultValue: 'Agent 运行中，请先停止后再 Fork / Clone / 跳转',
    }))
    return false
  }
  return true
}

async function refreshSidebarAndOpen(
  workspaceId: string,
  sessionId: string,
  sessionFile: string | undefined,
  opts?: { editorText?: string | null; startWorkspace?: string | null },
): Promise<void> {
  const store = useUIStore.getState()
  if (workspaceId) {
    try {
      const listRes = await ipcClient.invoke('session.list', { workspaceId })
      let sessions = (listRes?.sessions || []) as SessionItem[]
      if (sessionId && sessionFile && !sessions.some((s) => s.sessionId === sessionId || s.sessionFile === sessionFile)) {
        sessions = [
          {
            sessionId,
            sessionFile,
            title: 'Fork',
            updatedAt: Date.now(),
            messageCount: 0,
            modelId: '',
          } as SessionItem,
          ...sessions,
        ]
      }
      store.setSessions(sessions, workspaceId)
    } catch {
      /* list is best-effort */
    }
  }

  const currentWorkspace = useUIStore.getState().currentWorkspace
  // The user moved to another project while this ran: leave the result in its own project.
  if (!workspacePathsEqual(currentWorkspace, opts?.startWorkspace ?? workspaceId)) return
  if (!workspacePathsEqual(currentWorkspace, workspaceId)) {
    // Sidebar menu on another project's session: open the result there.
    const { activateWorkspace } = await import('@renderer/lib/activate-workspace')
    await activateWorkspace(workspaceId, { sessionId, sessionFile })
    if (!workspacePathsEqual(useUIStore.getState().currentWorkspace, workspaceId)) return
  } else {
    await openSessionIntoWorker(sessionId, sessionFile)
  }
  if (opts?.editorText != null && opts.editorText.length > 0) {
    useUIStore.getState().setComposerPrefill(opts.editorText)
  } else {
    useUIStore.getState().setComposerPrefill(null)
  }
  void import('@renderer/lib/composer-run-display').then((m) => m.refreshComposerRunDisplay())
}

/**
 * TUI /fork: new session file from a user entry; auto-switch + prefill prompt text.
 */
export async function forkSessionFromEntry(entryId: string, source?: ForkSource): Promise<boolean> {
  if (!assertIdleForBranchAction(source)) return false
  const sessionFile = source?.sessionFile || resolveSourceSessionFile()
  if (!sessionFile) {
    toast.warning(i18n.t('composer:toast.needSessionFile', { defaultValue: '未找到会话文件' }))
    return false
  }
  if (!entryId?.trim()) {
    toast.warning(i18n.t('composer:toast.needEntryId', { defaultValue: '缺少消息节点 id' }))
    return false
  }

  const startWorkspace = useUIStore.getState().currentWorkspace
  const workspaceId = source?.workspacePath || startWorkspace || ''
  try {
    const res = (await ipcClient.invoke('session.fork', {
      sessionFile,
      entryId: entryId.trim(),
      position: 'before',
      workspaceId: workspaceId || undefined,
    })) as {
      cancelled?: boolean
      error?: string
      editorText?: string
      sessionId?: string
      sessionFile?: string
      session?: { sessionId?: string; sessionFile?: string; error?: string }
    }

    if (res?.cancelled) {
      toast.info(i18n.t('composer:toast.forkCancelled', { defaultValue: '已取消 Fork' }))
      return false
    }
    const err = res?.error || res?.session?.error
    if (err) {
      if (err === 'SESSION_BUSY') {
        toast.warning(i18n.t('composer:toast.sessionBusyBranch', {
          defaultValue: 'Agent 运行中，请先停止后再 Fork / Clone / 跳转',
        }))
      } else {
        toast.error(err)
      }
      return false
    }

    const newId = res.sessionId || res.session?.sessionId || ''
    const newFile = res.sessionFile || res.session?.sessionFile
    if (!newId && !newFile) {
      toast.error(i18n.t('composer:toast.forkFailed', { defaultValue: 'Fork 失败' }))
      return false
    }

    inheritPurgedSessionInStore(sessionFile, newFile)
    await refreshSidebarAndOpen(workspaceId, newId || newFile || '', newFile, {
      editorText: typeof res.editorText === 'string' ? res.editorText : '',
      startWorkspace,
    })
    toast.success(
      res.editorText
        ? i18n.t('composer:toast.forkedWithPrefill', {
            defaultValue: '已 Fork 到新会话，原文已填入输入框',
          })
        : i18n.t('composer:toast.forked', { defaultValue: '已 Fork 到新会话' }),
    )
    return true
  } catch (e: unknown) {
    console.error('[fork] failed:', e)
    toast.error((e instanceof Error ? e.message : String(e)) || 'Fork 失败')
    return false
  }
}

/** TUI /clone: duplicate active branch into a new session file; empty composer. */
export async function cloneCurrentSession(source?: ForkSource): Promise<boolean> {
  if (!assertIdleForBranchAction(source)) return false
  const sessionFile = source?.sessionFile || resolveSourceSessionFile()
  if (!sessionFile) {
    toast.warning(i18n.t('composer:toast.needSessionFile', { defaultValue: '未找到会话文件' }))
    return false
  }

  const startWorkspace = useUIStore.getState().currentWorkspace
  const workspaceId = source?.workspacePath || startWorkspace || ''
  try {
    const res = (await ipcClient.invoke('session.clone', {
      sessionFile,
      workspaceId: workspaceId || undefined,
    })) as {
      cancelled?: boolean
      error?: string
      sessionId?: string
      sessionFile?: string
      session?: { sessionId?: string; sessionFile?: string; error?: string }
    }

    if (res?.cancelled) {
      toast.info(i18n.t('composer:toast.cloneCancelled', { defaultValue: '已取消 Clone' }))
      return false
    }
    const err = res?.error || res?.session?.error
    if (err) {
      if (err === 'SESSION_BUSY' || err === 'nothing_to_clone') {
        toast.warning(
          err === 'nothing_to_clone'
            ? i18n.t('composer:toast.nothingToClone', { defaultValue: '当前没有可 Clone 的内容' })
            : i18n.t('composer:toast.sessionBusyBranch', {
                defaultValue: 'Agent 运行中，请先停止后再 Fork / Clone / 跳转',
              }),
        )
      } else {
        toast.error(err)
      }
      return false
    }

    const newId = res.sessionId || res.session?.sessionId || ''
    const newFile = res.sessionFile || res.session?.sessionFile
    if (!newId && !newFile) {
      toast.error(i18n.t('composer:toast.cloneFailed', { defaultValue: 'Clone 失败' }))
      return false
    }

    inheritPurgedSessionInStore(sessionFile, newFile)
    await refreshSidebarAndOpen(workspaceId, newId || newFile || '', newFile, { editorText: null, startWorkspace })
    toast.success(i18n.t('composer:toast.cloned', { defaultValue: '已 Clone 到新会话' }))
    return true
  } catch (e: unknown) {
    console.error('[clone] failed:', e)
    toast.error((e instanceof Error ? e.message : String(e)) || 'Clone 失败')
    return false
  }
}

export async function loadForkCandidates(source?: ForkSource): Promise<Array<{ entryId: string; text: string }>> {
  if (isCurrentSource(source) && isCurrentSubagentSessionPreview()) return []
  const sessionFile = source?.sessionFile || resolveSourceSessionFile()
  if (!sessionFile) return []
  try {
    const res = (await ipcClient.invoke('session.forkCandidates', { sessionFile })) as {
      messages?: Array<{ entryId: string; text: string }>
    }
    return res?.messages || []
  } catch {
    return []
  }
}
