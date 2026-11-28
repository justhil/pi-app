import { toast } from 'sonner'
import i18n from '@renderer/lib/i18n'
import { onExtensionUIRequest, onExtensionUIDismiss } from '@renderer/lib/ipc-client'
import { useExtensionUIStore, type ExtensionUIPending } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import {
  formatExtensionNotifyMessage,
  shouldShowExtensionNotify,
} from '@renderer/lib/extension-notify-policy'
import { signalDesktopAlert } from '@renderer/lib/desktop-alerts'
import type { AskQuestionPayload } from '@renderer/features/extension-ui/questionnaire-dialog'
import type { ImageReviewPayload } from '@renderer/features/extension-ui/image-review-dialog'
import { traceAudioRenderer } from '@renderer/lib/audio-trace'
import { alertTrace } from '@renderer/lib/alert-trace'
import {
  interactiveToolsForDialogMethod,
  linkExtensionDialogToToolRow,
  reconcileAllStaleInteractiveToolRows,
  reconcileStaleInteractiveToolRows,
} from '@renderer/lib/extension-ui-tool-sync'

let started = false
const seenDialogIds = new Set<string>()

function pruneSeenIds(): void {
  if (seenDialogIds.size > 120) seenDialogIds.clear()
}

function sessionFileFromRaw(raw: Record<string, unknown>): string | undefined {
  return typeof raw.sessionFile === 'string' && raw.sessionFile ? raw.sessionFile : undefined
}

function readDeadlineTiming(raw: Record<string, unknown>): { timeoutMs?: number; deadlineAt?: number } {
  const rawTimeout = typeof raw.timeout === 'number' && Number.isFinite(raw.timeout) && raw.timeout > 0 ? Math.round(raw.timeout) : undefined
  const rawDeadline =
    typeof raw.deadlineAt === 'number' && Number.isFinite(raw.deadlineAt) && raw.deadlineAt > 0
      ? raw.deadlineAt
      : rawTimeout
        ? Date.now() + rawTimeout
        : undefined
  return {
    ...(rawTimeout ? { timeoutMs: rawTimeout } : {}),
    ...(rawDeadline ? { deadlineAt: rawDeadline } : {}),
  }
}

function rawToPending(raw: Record<string, unknown>): ExtensionUIPending | null {
  const id = raw.id as string
  const method = raw.method as string
  const sessionFile = sessionFileFromRaw(raw)
  const timing = readDeadlineTiming(raw)
  if (method === 'custom' && raw.kind === 'ask_user_question') {
    return {
      id,
      method: 'ask_user_question',
      questions: (raw.questions as AskQuestionPayload[]) || [],
      ...timing,
      sessionFile,
    }
  }
  if (method === 'custom' && raw.kind === 'image_review') {
    return {
      id,
      method: 'image_review',
      payload: {
        image: (raw.image as string) || '',
        title: (raw.title as string) || i18n.t('extension:imageReview.defaultTitle'),
        question: (raw.question as string) || i18n.t('extension:imageReview.defaultQuestion'),
        context: raw.context as string | undefined,
        options: (raw.options as string[]) || [
          i18n.t('extension:imageReview.options.accept'),
          i18n.t('extension:imageReview.options.revise'),
          i18n.t('extension:imageReview.options.redo'),
          i18n.t('extension:imageReview.options.cancel'),
        ],
        allowFeedback: raw.allowFeedback !== false,
      },
      sessionFile,
    }
  }
  if (method === 'select') {
    return {
      id,
      method: 'select',
      title: raw.title as string,
      options: (raw.options as string[]) || [],
      ...timing,
      sessionFile,
    }
  }
  if (method === 'confirm') {
    return {
      id,
      method: 'confirm',
      title: raw.title as string,
      message: raw.message as string,
      ...timing,
      sessionFile,
    }
  }
  if (method === 'input') {
    return {
      id,
      method: 'input',
      title: raw.title as string,
      placeholder: raw.placeholder as string | undefined,
      ...timing,
      sessionFile,
    }
  }
  if (method === 'editor') {
    return {
      id,
      method: 'editor',
      title: (raw.title as string) || i18n.t('extension:dialogBody.needsAction'),
      prefill: typeof raw.prefill === 'string' ? raw.prefill : undefined,
      sessionFile,
    }
  }
  return null
}

export function clearExtensionDialogDedupe(): void {
  seenDialogIds.clear()
}

/** Worker 侧对话框超时/中止或 compaction 开始时，清理 Renderer 悬挂状态 */
export function dismissExtensionDialogState(id?: string): void {
  const st = useExtensionUIStore.getState()
  const activeId = st.activePending?.id
  const suspendedId = st.suspended?.requestId
  if (id && activeId !== id && suspendedId !== id) return
  if (id) seenDialogIds.delete(id)
  if (!id) {
    st.clearAllDialogs()
    return
  }
  st.dismissById(id)
}

/** 只注册一次 IPC 监听，避免 StrictMode 双挂载导致重复 toast / 双提示音 */
export function ensureExtensionUIChannel(): void {
  if (started) return
  started = true

  onExtensionUIDismiss((payload) => {
    if (payload.type === 'extension-ui-dismiss-all') {
      seenDialogIds.clear()
      useExtensionUIStore.getState().clearAllDialogs()
      reconcileAllStaleInteractiveToolRows()
      return
    }
    if (payload.type === 'extension-ui-dismiss' && payload.id) {
      dismissExtensionDialogState(payload.id)
      reconcileStaleInteractiveToolRows(payload.id)
    }
  })

  onExtensionUIRequest((raw) => {
    const req = raw as Record<string, unknown>
    const method = req.method as string

    if (method === 'notify') {
      const t = (req.notifyType as string) || 'info'
      const msg = formatExtensionNotifyMessage(String(req.message || ''))
      traceAudioRenderer('extension-ui.notify', { notifyType: t, msg: msg?.slice(0, 120) })
      const show = shouldShowExtensionNotify(msg, t)
      alertTrace('extension notify', { notifyType: t, show, msg: msg?.slice(0, 120) })
      if (!show) return
      const running = useUIStore.getState().runState.status === 'running'
      const fromSlash = req.slashDispatched === true
      if (!running && !fromSlash && t !== 'error') {
        alertTrace('skip notify toast (not running)', { notifyType: t })
        return
      }
      alertTrace('sonner toast（Windows 常伴系统提示音，≠ 设置里的「提示音」）', { notifyType: t })
      traceAudioRenderer('extension-ui.toast', { notifyType: t, msg: msg?.slice(0, 120) })
      if (t === 'error') toast.error(msg)
      else if (t === 'warning') toast.warning(msg)
      else toast.info(msg)
      return
    }

    const p = rawToPending(req)
    if (!p) return

    // Dialog requests (select/confirm/input/custom) must always be shown, even when
    // the agent is not running — pi-rewind and other extensions call ui.select()/confirm()
    // during session_before_tree / session_before_fork which happen outside agent turns.
    if (seenDialogIds.has(p.id)) return
    seenDialogIds.add(p.id)
    pruneSeenIds()

    traceAudioRenderer('extension-ui.dialog', { method: p.method, id: p.id })
    const viewFile = useUIStore.getState().historySessionFile
    const isBackground = !!p.sessionFile && !!viewFile && !sessionFilesEqual(p.sessionFile, viewFile)
    if (isBackground) {
      useExtensionUIStore.getState().setActivePending(p)
      useExtensionUIStore.getState().suspendActive({ background: true })
    } else {
      useExtensionUIStore.getState().enqueuePending(p)
    }
    const rawToolCallId = typeof req.toolCallId === 'string' ? req.toolCallId : undefined
    if (interactiveToolsForDialogMethod(p.method).size > 0) {
      linkExtensionDialogToToolRow(p.id, p.method, rawToolCallId)
    }

    const body =
      p.method === 'image_review'
        ? p.payload.title || i18n.t('extension:imageReview.defaultTitle')
        : p.method === 'ask_user_question'
          ? i18n.t('extension:dialogBody.askUserQuestion')
          : p.method === 'confirm' || p.method === 'select' || p.method === 'input' || p.method === 'editor'
            ? p.title || i18n.t('extension:dialogBody.needsAction')
            : i18n.t('extension:dialogBody.needsAction')
    // Desktop alert only when running (idle dialog doesn't need system notification)
    if (useUIStore.getState().runState.status === 'running') {
      void signalDesktopAlert('extension_ui', {
        title: i18n.t('extension:alertTitle.waitingAction'),
        body,
      })
    }
  })
}