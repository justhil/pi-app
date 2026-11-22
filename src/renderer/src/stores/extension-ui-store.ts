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
  pendingQueue: ExtensionUIPending[]
  suspended: ExtensionUISuspended | null
  inlineHostMounted: boolean
  inlineQuestionnaireExpandedModal: boolean
  setInlineHostMounted: (mounted: boolean) => void
  setInlineQuestionnaireExpandedModal: (expanded: boolean) => void
  setActivePending: (p: ExtensionUIPending | null) => void
  enqueuePending: (p: ExtensionUIPending) => void
  suspendActive: (meta: { toolCallId?: string; toolName?: string; timelineItemId?: string; background?: boolean }) => void
  resumeSuspended: () => void
  clearAfterRespond: () => void
  cancelForSession: (sessionFile: string | null) => void
  clearAllDialogs: () => void
  dismissById: (id: string) => void
  parkForSessionSwitch: () => void
  restoreForSession: (sessionFile: string) => void
  resetForSessionContext: () => void
  pruneStaleSuspension: () => void
}

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

function popNextFromQueue(queue: ExtensionUIPending[]): {
  next: ExtensionUIPending | null
  rest: ExtensionUIPending[]
} {
  if (queue.length === 0) return { next: null, rest: [] }
  return { next: queue[0], rest: queue.slice(1) }
}

function cancelPendingDialog(reason: string): void {
  const { activePending, pendingQueue, suspended } = useExtensionUIStore.getState()
  const ids = new Set<string>()
  if (activePending) ids.add(activePending.id)
  for (const q of pendingQueue) ids.add(q.id)
  if (suspended) ids.add(suspended.requestId)
  for (const id of ids) {
    void ipcClient.invoke('extension.cancelUI', { id, reason }).catch(() => {})
  }
}

export const useExtensionUIStore = create<ExtensionUIState>((set, get) => ({
  activePending: null,
  pendingQueue: [],
  suspended: null,
  inlineHostMounted: false,
  inlineQuestionnaireExpandedModal: false,
  setInlineHostMounted: (inlineHostMounted) => set({ inlineHostMounted }),
  setInlineQuestionnaireExpandedModal: (inlineQuestionnaireExpandedModal) =>
    set({ inlineQuestionnaireExpandedModal }),

  setActivePending: (p) => {
    const prev = get().activePending
    if (prev && (!p || prev.id !== p.id)) syncWaitingUi(pendingSessionFile(prev), false)
    if (p) syncWaitingUi(pendingSessionFile(p), true)
    set((s) => ({
      activePending: p,
      pendingQueue: p ? s.pendingQueue.filter((q) => q.id !== p.id) : s.pendingQueue,
    }))
  },

  enqueuePending: (p) => {
    const { activePending, pendingQueue } = get()
    if (activePending?.id === p.id || pendingQueue.some((q) => q.id === p.id)) return
    syncWaitingUi(pendingSessionFile(p), true)
    if (!activePending) {
      set({ activePending: p })
      return
    }
    set({ pendingQueue: [...pendingQueue, p] })
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
    const { next: queuedNext, rest } = popNextFromQueue(get().pendingQueue)
    set({
      activePending: queuedNext,
      pendingQueue: rest,
      suspended: next.background || !keepParked ? next : keepParked,
    })
  },

  resumeSuspended: () => {
    const s = get().suspended
    if (!s) return
    const prevActive = get().activePending
    syncWaitingUi(pendingSessionFile(s.pending), true)
    set((state) => ({
      activePending: s.pending,
      pendingQueue: prevActive ? [prevActive, ...state.pendingQueue] : state.pendingQueue,
      suspended: null,
    }))
  },

  clearAfterRespond: () => {
    const { activePending, pendingQueue, suspended } = get()
    const { next, rest } = popNextFromQueue(pendingQueue)
    const keep =
      suspended &&
      suspended.background &&
      (!activePending || suspended.requestId !== activePending.id)
        ? suspended
        : null
    const stillWaitingSameSession =
      next &&
      activePending &&
      sessionFilesEqual(pendingSessionFile(next), pendingSessionFile(activePending))
    if (!stillWaitingSameSession) {
      syncWaitingUi(pendingSessionFile(activePending), false)
    }
    if (!keep) syncWaitingUi(pendingSessionFile(suspended?.pending), false)
    if (next) syncWaitingUi(pendingSessionFile(next), true)
    set({ activePending: next, pendingQueue: rest, suspended: keep, inlineQuestionnaireExpandedModal: false })
  },

  cancelForSession: (sessionFile) => {
    const { activePending, pendingQueue, suspended } = get()
    const pending = [activePending, ...pendingQueue, suspended?.pending].filter(
      (p): p is ExtensionUIPending => !!p && (!p.sessionFile || sessionFilesEqual(p.sessionFile, sessionFile)),
    )
    for (const id of new Set(pending.map((p) => p.id))) {
      void ipcClient.invoke('extension.cancelUI', { id, reason: 'user-abort' }).catch(() => {})
      get().dismissById(id)
    }
  },

  pruneStaleSuspension: () => pruneStaleSuspension(),

  clearAllDialogs: () => {
    const { activePending, pendingQueue, suspended } = get()
    for (const p of [activePending, ...pendingQueue, suspended?.pending]) {
      if (p) syncWaitingUi(pendingSessionFile(p), false)
    }
    set({ activePending: null, pendingQueue: [], suspended: null, inlineQuestionnaireExpandedModal: false })
  },

  dismissById: (id) => {
    const { activePending, pendingQueue, suspended } = get()
    const remainingQueue = pendingQueue.filter((q) => q.id !== id)
    if (activePending?.id === id) {
      const { next, rest } = popNextFromQueue(remainingQueue)
      const sameSession =
        next && sessionFilesEqual(pendingSessionFile(next), pendingSessionFile(activePending))
      if (!sameSession) syncWaitingUi(pendingSessionFile(activePending), false)
      if (next) syncWaitingUi(pendingSessionFile(next), true)
      set({ activePending: next, pendingQueue: rest })
      return
    }
    if (suspended?.requestId === id) {
      syncWaitingUi(pendingSessionFile(suspended.pending), false)
      set({ suspended: null, pendingQueue: remainingQueue })
      return
    }
    if (remainingQueue.length !== pendingQueue.length) {
      const removed = pendingQueue.find((q) => q.id === id)
      if (removed) syncWaitingUi(pendingSessionFile(removed), false)
      set({ pendingQueue: remainingQueue })
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
    const { activePending, pendingQueue, suspended } = get()
    cancelPendingDialog('session-reset')
    for (const p of [activePending, ...pendingQueue, suspended?.pending]) {
      if (p) syncWaitingUi(pendingSessionFile(p), false)
    }
    set({ activePending: null, pendingQueue: [], suspended: null, inlineQuestionnaireExpandedModal: false })
    void import('@renderer/lib/extension-ui-channel').then((m) => m.clearExtensionDialogDedupe())
  },
}))

export function extensionUiBlocksComposer(): boolean {
  pruneStaleSuspension()
  if (!hasOpenExtensionDialog()) return false
  const running = useUIStore.getState().runState.status === 'running'
  const p = useExtensionUIStore.getState().activePending
  if (!p) return false
  if (!running) return false
  return true
}
