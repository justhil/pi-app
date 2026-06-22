import { create } from 'zustand'
import { useUIStore } from '@renderer/stores/ui-store'
import type { AskQuestionPayload } from '@renderer/features/extension-ui/questionnaire-dialog'
import type { ImageReviewPayload } from '@renderer/features/extension-ui/image-review-dialog'

export type ExtensionUIPending =
  | { id: string; method: 'ask_user_question'; questions: AskQuestionPayload[] }
  | { id: string; method: 'select'; title: string; options: string[] }
  | { id: string; method: 'confirm'; title: string; message: string }
  | { id: string; method: 'input'; title: string; placeholder?: string }
  | { id: string; method: 'image_review'; payload: ImageReviewPayload }

export type ExtensionUISuspended = {
  requestId: string
  pending: ExtensionUIPending
  toolCallId?: string
  toolName?: string
  timelineItemId?: string
  suspendedAt: number
}

type ExtensionUIState = {
  activePending: ExtensionUIPending | null
  suspended: ExtensionUISuspended | null
  setActivePending: (p: ExtensionUIPending | null) => void
  suspendActive: (meta: { toolCallId?: string; toolName?: string; timelineItemId?: string }) => void
  resumeSuspended: () => void
  clearAfterRespond: () => void
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
  const items = useUIStore.getState().timelineItems
  const tid = suspended.timelineItemId
  if (!tid) {
    useExtensionUIStore.setState({ suspended: null })
    return
  }
  const row = items.find((i) => i.id === tid)
  if (!row?.extensionUiSuspended) useExtensionUIStore.setState({ suspended: null })
}

export const useExtensionUIStore = create<ExtensionUIState>((set, get) => ({
  activePending: null,
  suspended: null,

  setActivePending: (p) => set({ activePending: p }),

  suspendActive: (meta) => {
    const active = get().activePending
    if (!active) return
    set({
      activePending: null,
      suspended: {
        requestId: active.id,
        pending: active,
        toolCallId: meta.toolCallId,
        toolName: meta.toolName,
        timelineItemId: meta.timelineItemId,
        suspendedAt: Date.now(),
      },
    })
  },

  resumeSuspended: () => {
    const s = get().suspended
    if (!s) return
    set({ activePending: s.pending, suspended: null })
  },

  clearAfterRespond: () => set({ activePending: null, suspended: null }),

  pruneStaleSuspension: () => pruneStaleSuspension(),

  resetForSessionContext: () => {
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

