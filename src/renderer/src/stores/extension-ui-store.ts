import { create } from 'zustand'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { AskQuestionPayload } from '@renderer/features/extension-ui/questionnaire-dialog'
import type { ImageReviewPayload } from '@renderer/features/extension-ui/image-review-dialog'

export type ExtensionUIPending =
  | { id: string; method: 'ask_user_question'; questions: AskQuestionPayload[]; sessionFile?: string }
  | { id: string; method: 'select'; title: string; options: string[]; sessionFile?: string }
  | { id: string; method: 'confirm'; title: string; message: string; sessionFile?: string }
  | { id: string; method: 'input'; title: string; placeholder?: string; sessionFile?: string }
  | { id: string; method: 'image_review'; payload: ImageReviewPayload; sessionFile?: string }

export type ExtensionUISuspended = {
  requestId: string
  pending: ExtensionUIPending
  toolCallId?: string
  toolName?: string
  timelineItemId?: string
  background?: boolean
  suspendedAt: number
}

type ExtensionUIState = {
  activePending: ExtensionUIPending | null
  suspended: ExtensionUISuspended | null
  setActivePending: (p: ExtensionUIPending | null) => void
  suspendActive: (meta: { toolCallId?: string; toolName?: string; timelineItemId?: string; background?: boolean }) => void
  resumeSuspended: () => void
  clearAfterRespond: () => void
  clearAllDialogs: () => void
  dismissById: (id: string) => void
  parkForSessionSwitch: () => void
  restoreForSession: (sessionFile: string) => void
  resetForSessionContext: () => void
  pruneStaleSuspension: () => void
}

/** 仅全屏弹窗打开时阻塞（挂起后已关弹窗，可发消息、可切会话） */
function hasOpenExtensionDialog(): boolean {
  return useExtensionUIStore.getState().activePending != null
}

function pruneStaleSuspension(): void {
  const { activePending, suspended } = useExtensionUIStore.getState()
  if (activePending) return
  if (!suspended) return
  if (suspended.background) return
  const items = useUIStore.getState().timelineItems
  const tid = suspended.timelineItemId
  if (!tid) {
    useExtensionUIStore.setState({ suspended: null })
    return
  }
  const row = items.find((i) => i.id === tid)
  if (!row?.extensionUiSuspended) useExtensionUIStore.setState({ suspended: null })
}

function pendingSessionFile(pending: ExtensionUIPending | null | undefined): string | undefined {
  return pending?.sessionFile
}

function syncWaitingUi(sessionFile: string | undefined, waiting: boolean): void {
  const file = sessionFile || useUIStore.getState().historySessionFile
  if (!file) return
  useUIStore.getState().setSessionWaitingUi(file, waiting)
}

function cancelPendingDialog(reason: string): void {
  const { activePending, suspended } = useExtensionUIStore.getState()
  const id = activePending?.id ?? suspended?.requestId
  if (id) void ipcClient.invoke('extension.cancelUI', { id, reason }).catch(() => {})
}

export const useExtensionUIStore = create<ExtensionUIState>((set, get) => ({
  activePending: null,
  suspended: null,

  setActivePending: (p) => {
    const prev = get().activePending
    if (prev && (!p || prev.id !== p.id)) syncWaitingUi(pendingSessionFile(prev), false)
    if (p) syncWaitingUi(pendingSessionFile(p), true)
    set({ activePending: p })
  },

  suspendActive: (meta) => {
    const active = get().activePending
    if (!active) return
    syncWaitingUi(pendingSessionFile(active), true)
    const parked = get().suspended
    const next: ExtensionUISuspended = {
      requestId: active.id,
      pending: active,
      toolCallId: meta.toolCallId,
      toolName: meta.toolName,
      timelineItemId: meta.timelineItemId,
      background: meta.background === true || (!meta.timelineItemId && !!active.sessionFile),
      suspendedAt: Date.now(),
    }
    const keepParked =
      parked && parked.requestId !== next.requestId && parked.background === true ? parked : null
    set({
      activePending: null,
      suspended: next.background || !keepParked ? next : keepParked,
    })
  },

  resumeSuspended: () => {
    const s = get().suspended
    if (!s) return
    syncWaitingUi(pendingSessionFile(s.pending), true)
    set({ activePending: s.pending, suspended: null })
  },

  clearAfterRespond: () => {
    const { activePending, suspended } = get()
    syncWaitingUi(pendingSessionFile(activePending), false)
    const keep =
      suspended &&
      suspended.background &&
      (!activePending || suspended.requestId !== activePending.id)
        ? suspended
        : null
    if (!keep) syncWaitingUi(pendingSessionFile(suspended?.pending), false)
    set({ activePending: null, suspended: keep })
  },

  pruneStaleSuspension: () => pruneStaleSuspension(),

  clearAllDialogs: () => {
    const { activePending, suspended } = get()
    syncWaitingUi(pendingSessionFile(activePending || suspended?.pending), false)
    set({ activePending: null, suspended: null })
  },

  dismissById: (id) => {
    const { activePending, suspended } = get()
    if (activePending?.id === id) {
      syncWaitingUi(pendingSessionFile(activePending), false)
      set({ activePending: null })
      return
    }
    if (suspended?.requestId === id) {
      syncWaitingUi(pendingSessionFile(suspended.pending), false)
      set({ suspended: null })
    }
  },

  parkForSessionSwitch: () => {
    const active = get().activePending
    if (active) get().suspendActive({})
  },

  restoreForSession: (sessionFile: string) => {
    const s = get().suspended
    if (!s) return
    if (s.pending.sessionFile && !sessionFilesEqual(s.pending.sessionFile, sessionFile)) return
    get().resumeSuspended()
  },

  resetForSessionContext: () => {
    const { activePending, suspended } = get()
    const pendingFile = pendingSessionFile(activePending || suspended?.pending)
    cancelPendingDialog('session-reset')
    syncWaitingUi(pendingFile, false)
    set({ activePending: null, suspended: null })
    void import('@renderer/lib/extension-ui-channel').then((m) => m.clearExtensionDialogDedupe())
  },
}))

export function extensionUiBlocksComposer(): boolean {
  pruneStaleSuspension()
  if (!hasOpenExtensionDialog()) return false
  const running = useUIStore.getState().runState.status === 'running'
  // 无弹窗宿主可渲染的 pending（如 Worker 已超时 resolve）不应阻塞
  const p = useExtensionUIStore.getState().activePending
  if (!p) return false
  if (!running) return false
  return true
}

