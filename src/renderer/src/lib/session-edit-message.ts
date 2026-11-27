import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { clearSessionHistoryCache } from '@renderer/lib/session-history'
import { composerTurnActive } from '@renderer/lib/session-worker-sync'
import { isCurrentSubagentSessionPreview } from '@renderer/lib/subagent-session-preview'
import { sessionKeyOf } from '@renderer/stores/session-state'
import { sessionStoreApi } from '@renderer/stores/session-scope'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionItem, TimelineItem } from '@renderer/stores/ui-store-types'

function resolveTargetSessionFile(): string | null {
  const st = useUIStore.getState()
  if (st.historySessionFile) return st.historySessionFile
  const hit = st.sessions.find((s) => s.sessionId === st.currentSessionId)?.sessionFile
  return hit || null
}

function patchEditedTimelineRow(row: TimelineItem, nextText: string): Partial<TimelineItem> & Record<string, unknown> {
  if (row.type === 'user-message') {
    const keptAttachments = row.segments?.filter((seg) => seg.type === 'clipboard-image' || (seg.type === 'file' && seg.attachment.kind === 'image'))
    const nextSegments =
      keptAttachments && keptAttachments.length > 0
        ? [{ type: 'text' as const, text: nextText }, ...keptAttachments]
        : undefined
    return {
      text: nextText,
      payloadText: nextText,
      segments: nextSegments,
    }
  }
  return {
    text: nextText,
    thinkingText: undefined,
    thinkingDuration: undefined,
    incomplete: undefined,
    stopReason: 'stop',
    isError: undefined,
    errorMessage: undefined,
  }
}

function translateEditError(code: string | undefined): string {
  switch (code) {
    case 'SESSION_BUSY':
      return i18n.t('timeline:edit.sessionBusy')
    case 'empty_text':
      return i18n.t('timeline:edit.emptyText')
    case 'entry_not_found':
      return i18n.t('timeline:edit.entryNotFound')
    case 'not_editable_message':
      return i18n.t('timeline:edit.notEditable')
    default:
      return code || i18n.t('timeline:edit.failed')
  }
}

/**
 * Edit a persisted user or assistant message in place on disk and sync live Worker + UI store
 * without rewinding or branching the session tree.
 */
export async function editSessionMessageInPlace(opts: {
  itemId: string
  entryId: string
  text: string
}): Promise<boolean> {
  if (isCurrentSubagentSessionPreview()) {
    toast.warning(i18n.t('composer:toast.subagentPreviewReadOnly'))
    return false
  }

  const st = useUIStore.getState()
  const sessionFile = resolveTargetSessionFile()
  if (!sessionFile) {
    toast.warning(i18n.t('timeline:edit.needFile'))
    return false
  }

  const entryId = String(opts.entryId || '').trim()
  if (!entryId) {
    toast.warning(i18n.t('timeline:edit.needEntryId'))
    return false
  }

  const nextText = opts.text
  if (!nextText.trim()) {
    toast.warning(i18n.t('timeline:edit.emptyText'))
    return false
  }

  const busy = composerTurnActive({
    historySessionFile: sessionFile,
    workerLiveSnapshot: st.workerLiveSnapshot,
    sessionRuntimeRunning: st.sessionRuntimeRunning,
  })
  if (busy) {
    toast.warning(i18n.t('timeline:edit.sessionBusy'))
    return false
  }

  const workspaceId = st.currentWorkspace || undefined
  const firstUserEntryId = st.timelineItems.find((item) => item.type === 'user-message')?.sessionEntryId

  try {
    const res = (await ipcClient.invoke('session.editMessage', {
      sessionFile,
      ...(workspaceId ? { workspaceId } : {}),
      entryId,
      text: nextText,
    })) as { ok?: boolean; role?: 'user' | 'assistant'; error?: string }

    if (!res?.ok) {
      if (res?.error === 'SESSION_BUSY') {
        toast.warning(translateEditError(res.error))
      } else {
        toast.error(translateEditError(res?.error))
      }
      return false
    }

    const latest = useUIStore.getState()
    const applyPatchToItems = (items: TimelineItem[], updateFn: (id: string, patch: Partial<TimelineItem>) => void) => {
      const target =
        items.find((row) => row.id === opts.itemId) ??
        items.find(
          (row) =>
            row.sessionEntryId === entryId &&
            (res.role ? row.type === `${res.role}-message` : row.type === 'user-message' || row.type === 'assistant-message'),
        )
      if (target) {
        updateFn(target.id, patchEditedTimelineRow(target, nextText))
      }
    }

    if (sessionFilesEqual(latest.historySessionFile, sessionFile)) {
      applyPatchToItems(latest.timelineItems, latest.updateTimelineItem)
    } else {
      const scoped = sessionStoreApi(sessionKeyOf(sessionFile), () => `edit-${Date.now()}`)
      applyPatchToItems(scoped.get().timelineItems, scoped.get().updateTimelineItem)
    }

    clearSessionHistoryCache(sessionFile)
    void refreshSessionTree(sessionFile)

    if (workspaceId && firstUserEntryId === entryId) {
      void ipcClient
        .invoke('session.list', { workspaceId, refresh: true })
        .then((listRes: unknown) => {
          const sessions = ((listRes as { sessions?: SessionItem[] } | null)?.sessions ?? []) as SessionItem[]
          if (sessions.length > 0) {
            useUIStore.getState().setSessions(sessions, workspaceId)
          }
        })
        .catch(() => {})
    }

    return true
  } catch (e: unknown) {
    toast.error((e instanceof Error ? e.message : String(e)) || i18n.t('timeline:edit.failed'))
    return false
  }
}
